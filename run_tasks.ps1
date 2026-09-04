$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$ScriptDir/do_tasks.js"
