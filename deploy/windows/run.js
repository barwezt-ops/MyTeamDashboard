// Windows Script Host waits for Node and passes its exit code to Task Scheduler.
/* global ActiveXObject, WScript */
var shell = new ActiveXObject("WScript.Shell");
if (WScript.Arguments.Count() > 1) {
  shell.CurrentDirectory = WScript.Arguments(1);
  if (WScript.Arguments.Count() === 2) WScript.Quit(73);
  var managedCommand =
    '"' + WScript.Arguments(0) + '" deploy\\windows\\host.mjs';
  WScript.Quit(shell.Run(managedCommand, 0, true));
}
var command = '"' + WScript.Arguments(0) + '" server\\dist\\index.js';
WScript.Quit(shell.Run(command, 0, true));
