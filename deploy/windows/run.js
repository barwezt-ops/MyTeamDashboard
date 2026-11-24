// Windows Script Host waits for Node and passes its exit code to Task Scheduler.
/* global ActiveXObject, WScript */
var shell = new ActiveXObject("WScript.Shell");
var command = '"' + WScript.Arguments(0) + '" server\\dist\\index.js';
WScript.Quit(shell.Run(command, 0, true));
