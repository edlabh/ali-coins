$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$ScriptDir/collect.js"
