--[[--
KOReader's own Progress sync (the kosync plugin), which carries the reading position through
the dashboard: whether it's set up, and filling in its settings for a copy of this plugin
downloaded with the password.

Its settings are the "settings" table of settings/kosync.lua.

@module readingdashboard.progresssync
]]

local ProgressSync = {
    -- kosync's own constants
    FILENAME = 1,
    PROMPT = 1,
    SILENT = 2,
}

local function settingsFile()
    local DataStorage = require("datastorage")
    return require("luasettings"):open(DataStorage:getSettingsDir() .. "/kosync.lua")
end

local function current(ui)
    local live = ui and ui.kosync and ui.kosync.settings
    if live then return live end
    local ok, settings = pcall(function() return settingsFile():readSetting("settings") end)
    return ok and type(settings) == "table" and settings or nil
end

--- Whether Progress sync is logged in, to any server.
function ProgressSync.configured(ui)
    local settings = current(ui)
    return settings ~= nil and settings.userkey ~= nil
end

--- Points Progress sync at the dashboard, unless it has been set up already.
-- @param url the dashboard's address
-- @param password its admin password
-- @treturn boolean whether anything was written
function ProgressSync.prefill(ui, url, password)
    local file = settingsFile()
    local live = ui and ui.kosync and ui.kosync.settings
    local settings = live or file:readSetting("settings") or {}
    if settings.custom_server or settings.username or settings.userkey then return false end
    local values = {
        custom_server = url:gsub("/+$", "") .. "/kosync",
        username = "reader",
        userkey = require("ffi/sha2").md5(password),
        checksum_method = ProgressSync.FILENAME,
        send_metadata = true,
        auto_sync = true,
        sync_forward = ProgressSync.SILENT,
        sync_backward = ProgressSync.PROMPT,
    }
    for k, v in pairs(values) do settings[k] = v end
    -- the running plugin writes its own table back, so it has to hold these too
    if live then ui.kosync.updated = true end
    file:saveSetting("settings", settings)
    file:flush()
    return true
end

return ProgressSync
