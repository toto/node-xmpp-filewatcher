var path = require('path');
var fs = require('fs');
var sys = require('sys');
var xmpp = require('node-xmpp'); // https://github.com/astro/node-xmpp
var watch = require('watch');    // https://github.com/mikeal/watch
var json = require('json');
var argv = process.argv;

Array.prototype.contains = function (element) {
  for (var i = 0; i < this.length; i++) {
    if (this[i] == element) {
      return true;
    }
  }
  return false;
};


var FileWatcher = {
  quiet: false,
  connected: false,
  connection: null,
  jabberid: null,
  server: null,
  monitor: null,
  pidFile: null,
  subscribedJids: [],
  commandJids: [],  
  ressource: "file_watcher",
  helpText: "I can't help you.",
  
  createPidFile: function() {
    var pid = null;

    if (path.exists(FileWatcher.pidFile)) {
      pid = fs.readFileSync(FileWatcher.pidFile, 'utf8');    
      if (pid != process.pid.toString()) {
        sys.puts("PID file " + FileWatcher.pidFile + ' exists. Already running as PID ' + pid + '?');
        process.exit(-1);
      }
    } else {
      fs.writeFileSync(FileWatcher.pidFile, process.pid.toString());        
    }   
  },
  
  unlinkPidFile: function() {
    if(FileWatcher.pidFile && fs.readFileSync(FileWatcher.pidFile, 'utf8') === process.pid.toString()) {
       fs.unlinkSync(FileWatcher.pidFile);
    }    
  },
  
  sendToSubscribers: function(text) {

    var index;
    for (index = 0; index < FileWatcher.subscribedJids.length; index += 1) {
      var toJid = FileWatcher.subscribedJids[index];
      
      var message = new xmpp.Element('message',
                                    { to: toJid,
                                    type: 'chat'});
      message.c('body').t(text);  
      FileWatcher.connection.send(message);
    }
  },
  
  setWatchedDir: function(filepath) {
    FileWatcher.monitor = watch.createMonitor(filepath, function (monitor) {
       monitor.on("created", function (f, curr, prev) {
         var str = "File created: " + f.toString().replace(filepath + '/', '');
         FileWatcher.sendToSubscribers(str);
      //   console.log(str);         
       });
       monitor.on("removed", function (f, stat) {
         var str = "File removed: " + f.toString().replace(filepath + '/', '');         
         FileWatcher.sendToSubscribers(str);
       //  console.log(str);
       });
     });    
  },
  
  commandResponder: function(stanza) {
   // console.log("Got stanza: " + stanza.toString());
    if (stanza.attrs.type !== 'error' &&
        stanza.is('message') &&
        stanza.getChildText('body') != null ) {
          
        var fromJid = stanza.attrs.from.replace(/\/.+$/,'');
        
        if(FileWatcher.commandJids.contains(fromJid)) {    
            var replyBody = '';
            var command = stanza.getChildText('body');
            switch(command) {
              case 'help':
                replyBody = FileWatcher.helpText;
                break;
              default:
                replyBody = "Sorry, but I don't know how to do '" + command + "'";
                break;
            }
            
            var reply = new xmpp.Element('message',
                                        { to: stanza.attrs.from,
                                          type: 'chat'});
            reply.c('body').t(replyBody);
            
            FileWatcher.connection.send(reply);
            
        } else {
            console.log("Ignoring command from unauthorized jid: " + fromJid);          
        }
    }
  },
  
  getJid: function() {
    return FileWatcher.jabberid + '/' + FileWatcher.ressource;
  },
  
  changePresence: function(type, status, message) {
    var attributes = {from: FileWatcher.getJid()};
    if (type != null) {
      attributes['type'] = type;
    }
    
    var presence = new xmpp.Element('presence', attributes);    
    if (status != null) {
      presence.c('show').t(status);          
    }

    
    if (message != null) {
       presence.c('status').t(message);      
    }
    
//    console.log("Presence change: " + presence.toString());
    FileWatcher.connection.send(presence);
  },
  
  connect: function(jabberid, password, server) {
    FileWatcher.jabberid = jabberid;
    FileWatcher.server = server;
    
    // Establish a connection
    var connection = new xmpp.Client({
        jid: FileWatcher.getJid(),
        password: password,
        host: server,
        port: 5222
    });        
    

    
    connection.on('online', function() {
       console.log("Going Online");   
       
       FileWatcher.changePresence(null, 'chat', 'Serving my master.');
          
       FileWatcher.connected = true;
    });
    connection.on('error', function(e) {
       console.log("Error: " + e);      
    });    
    // set up the responder
    connection.on('stanza', FileWatcher.commandResponder);
    FileWatcher.connection = connection;
    
    
  },
  
  disconnect: function() {
    console.log("Going Offline");

    FileWatcher.changePresence('unavailable', null, "Going offline");
    FileWatcher.connection.end();
    FileWatcher.connected = false;
    console.log("Bye!");        
  }
  
};

process.on('SIGINT', function () {
    // disconnect and exit on SIGINT e.g. ctrl-c
    console.log('Got SIGINT.');
    FileWatcher.disconnect();
    FileWatcher.unlinkPidFile();
    
    process.exit(0);
});

process.on('SIGTERM', function () {
    // disconnect and exit on SIGINT e.g. ctrl-c
    console.log('Got SIGTERM. Quitting…');
    FileWatcher.disconnect();
    FileWatcher.unlinkPidFile();
    
    process.exit(0);
});

if (argv[2] == null) {
  sys.puts("Usage: " + argv[0] + " " + argv[1] + " dir_to_watch"); 
  sys.puts("");
  sys.puts("Configuration sits in ~/.file_watch/settings.json. Required key:\n");
  sys.puts(" - subscribedJids (Array)");
  sys.puts(" - commandJids (Array)");
  sys.puts(" - username (String)"); 
  sys.puts(" - password (String)");  
  sys.puts(" - server (String)"); 
  sys.puts("");
  process.exit(-1);
}


var dotdir = fs.realpathSync(process.env['HOME'] + "/.file_watch/settings.json");
var settingsData = fs.readFileSync(dotdir);
var settings = json.parse(settingsData);


if(settings['pidFile']) {
  FileWatcher.pidFile = settings['pidFile'];  
  
  FileWatcher.createPidFile();

}


FileWatcher.setWatchedDir(argv[2]);


FileWatcher.subscribedJids = settings['subscribedJids'];
FileWatcher.commandJids = settings['commandJids'];




// connect 
FileWatcher.connect(settings['username'],
                    settings['password'],
                    settings['server']);

                    

