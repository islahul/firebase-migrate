/**
 * Created by Islahul on 14/11/14.
 */
process.env.TZ = 'Asia/Calcutta';

var Firebase                   = require('firebase'),
    _                          = require('underscore'),
    CONFIG                     = require('./configs/'+process.argv[2].toLowerCase()+'/CONFIG.json'),
    migrationHistory           = require('./migration_history.json'),
    backupHistory              = require('./backup_history.json'),
    diff                       = require('deep-diff').diff,
    fs                         = require('fs');


// Initialising server config
var mode = process.argv[2].toUpperCase();
var command = process.argv[3].toLowerCase();
var secondCommand = (process.argv[4] || "").toLowerCase();
var thirdCommand = (process.argv[5] || "").toLowerCase();
var firebaseURL = CONFIG.serverURL,
    firebaseSecret = CONFIG.firebaseSecret,
    now = new Date(),
//serverIpURL = CONFIG.serverIpURL,
    port = CONFIG.port,
    migrationName,
    migration;
var COMMANDS = {
  "run": [],
  "test": [],
  "rollback": [],
  "backup": ["create", "load"],
  "list": ["migrations", "backups"]
};

// Check commands and arguments
if(!COMMANDS[command]) {
  console.log('Command not found ', command);
  process.exit();
}
else {
  if(COMMANDS[command].length > 0) {
    if(COMMANDS[command].indexOf(secondCommand) === -1) {
      console.log('Secondary command not found ', secondCommand);
      process.exit();
    }
  }
}

if(["run", "test", "rollback"].indexOf(command)!= -1 && !secondCommand) {
  console.log('No migrations specified.');
  process.exit();
}
else if(["run", "test", "rollback"].indexOf(command)!= -1){
  migrationName = secondCommand;
  try {
    migration = require('./migrations/'+migrationName+'.js');
  } catch(e) {
    console.log('Could not find migration. Please check if file exists migrations/'+migrationName+'.js');
    process.exit();
  }
}

// Lets begin
console.log("Selected Environment: ", mode);

if(["run", "test", "rollback", "backup"].indexOf(command) != -1) {
  var firebaseRef = new Firebase(firebaseURL);
  console.log(firebaseURL);
  firebaseRef.authWithCustomToken(firebaseSecret, function(error, authData) {
    if(!error) {
      processDBCommand(command, secondCommand, migrationName, migration);
    }
  });
}
else {
  processListCommand(command, secondCommand);
}


function processDBCommand(command, secondCommand, migrationName, migration) {
  var firebaseRef;
  switch(command) {
    case "run":
      console.log("Migration run "+ migrationName +" started");
      firebaseRef = new Firebase(firebaseURL+migration.collectionName);
      firebaseRef.transaction(function(initValue) {
        migration.run(initValue);
        return initValue;
      }, function(error, committed) {
        if(error) {
          console.log("Migration failed, transaction failure", error);
          process.exit();
        }
        else {
          console.log("Migration #"+ migrationName +" successful, have a beer now.");
          addMigrationHistory('run', migrationName, function() {
            process.exit();
          });
        }
      });
      break;

    case "rollback":
      console.log("Migration run "+ migrationName +" started");
      firebaseRef = new Firebase(firebaseURL+migration.collectionName);
      firebaseRef.transaction(function(initValue) {
        migration.rollback(initValue);
        return initValue;
      }, function(error, committed) {
        if(error) {
          console.log("Migration Rollback failed, transaction failure", error);
          process.exit();
        }
        else {
          console.log("Migration Rollback #"+ migrationName +" successful, have a beer now.");
          addMigrationHistory('rollback', migrationName, function() {
            process.exit();
          });
        }
      });
      break;

    case "test":
      var testCase;
      console.log("Testing #"+ migrationName);
      _.each(migration.testCases, function(test, index) {
        testCase = deepCopy(test.input);
        migration.run(testCase);
        if(_.isEqual(testCase, test.expected)) {
          console.log("Run Passed ", index+1);
        }
        else {
          console.log(JSON.stringify(diff(testCase, test.expected), null, 4));
          console.log("Run Failed ", index+1);
        }
      });
      _.each(migration.testCases, function(test, index) {
        testCase = deepCopy(test.expected);
        migration.rollback(testCase);
        if(_.isEqual(testCase, test.input)) {
          console.log("Rollback Passed ", index+1);
        }
        else {
          console.log(JSON.stringify(diff(testCase, test.input), null, 4));
          console.log("Rollback Failed ", index+1);
        }
      });
      process.exit();
      break;

    case "backup":
      switch(secondCommand) {
        case "create":
          createBackup('create_backup_'+getDateString(now)+'-'+getTimeString(now), function(backupName) {
            console.log("Backup Create Success #", backupName);
            process.exit();
          });
          break;
        case "load":
          try {
            loadBackup(thirdCommand, function(backupId) {
              console.log("Backup Load Success #", backupId);
              addMigrationHistory('backup', backupId, function() {
                process.exit();
              });
            });
          }
          catch(e) {
            console.log('Backup not found #'+ thirdCommand);
            process.exit();
          }
          break;
      }
      break;
  }
}


function processListCommand(command, secondCommand) {
  switch(command) {
    case 'list':
      switch(secondCommand) {
        case 'migrations':
          _.each(migrationHistory, function(migrationObj) {
            console.log( spacer(migrationObj.type), spacer(migrationObj.name), spacer(migrationObj.timestamp) );
          });
          break;
        case 'backups':
          _.each(backupHistory, function(backupObj) {
            console.log( spacer(backupObj.type), spacer(backupObj.name), spacer(backupObj.timestamp));
          });
          break;
      }
      break;
  }
}


function addMigrationHistory(migration_type, migration_name, callback) {
  migrationHistory.push({
    type: migration_type,
    name: migration_name,
    timestamp: now.getTime()
  });
  createJSONFile('./migration_history.json', migrationHistory, function() {
    console.log('Migration History added '+ migration_type +': '+ migration_name);
    callback && callback();
  });
}


function addBackupHistory(backupName, callback) {
  backupHistory.push({
    type: 'backup',
    name: backupName,
    timestamp: now.getTime()
  });
  console.log(JSON.stringify(backupHistory));
  createJSONFile('./backup_history.json', backupHistory, function() {
    console.log('Backup History added ' + backupName);
    callback && callback();
  });
}


function createBackup(backupName, callback) {
  var rootRef = new Firebase(firebaseURL);

  rootRef.once('value', function(snapshot) {
    createJSONFile('./backups/'+backupName+'.json', snapshot.val(), function() {
      addBackupHistory(backupName);
      callback(backupName);
    });
  });
}


function loadBackup(backupId, callback) {
  var rootRef = new Firebase(firebaseURL);
  var backup = require('./backups/'+ backupId +'.json');

  rootRef.set(backup, function() {
    callback(backupId);
  });
}


function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}


function equals(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}


function spacer(str) {
  return (str + "                       ").slice(0,35);
}


function createJSONFile(path, data, callback) {
  var f = fs.createWriteStream(path);

  f.once('open', function() {
    f.write(JSON.stringify(data, null, 4), function(err) {
      if(!err) {
        console.log("JSON File created #"+path);
      }
      callback();
    });
  });
}


function getDateString(date) {
  var response = date.getFullYear() + '-';

  response += ('0' + (date.getMonth()+1)).slice(-2) + '-';
  response += ('0' + date.getDate()).slice(-2);

  return response;
}


function getTimeString(date) {
  return date.toLocaleTimeString();
}
