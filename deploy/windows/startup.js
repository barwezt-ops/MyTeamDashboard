/* global ActiveXObject, WScript */
var shell = new ActiveXObject("WScript.Shell");
var fs = new ActiveXObject("Scripting.FileSystemObject");
var operation = WScript.Arguments(0);
var repo = WScript.Arguments(1);
try {
  var folder = shell.SpecialFolders("Startup");
  if (!folder || !fs.FolderExists(folder)) WScript.Quit(2);
  var path = fs.BuildPath(folder, "Team Dashboard.lnk");
  var exists = fs.FileExists(path);
  var link = shell.CreateShortcut(path);
  if (exists && link.WorkingDirectory.toLowerCase() !== repo.toLowerCase())
    WScript.Quit(3);
  if (operation === "inspect") WScript.Quit(exists ? 0 : 4);
  if (operation === "remove") {
    if (exists) fs.DeleteFile(path);
  } else {
    link.TargetPath = WScript.FullName;
    link.Arguments = WScript.Arguments(2);
    link.WorkingDirectory = repo;
    link.Save();
    if (!fs.FileExists(path)) WScript.Quit(2);
  }
} catch (error) {
  WScript.Quit(error.number === -2147024891 ? 5 : 2);
}
