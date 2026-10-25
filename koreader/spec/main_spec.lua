-- Smoke tests for main.lua with stubbed KOReader modules: plugin init, defaults.lua
-- pre-fill, menu construction, and the Moon+ feel apply/restore cycle with touch zones.

local tmpdir = os.tmpname()
os.remove(tmpdir)
os.execute("mkdir -p '" .. tmpdir .. "/plugin'")

local function fakeSettings(data)
    local s = { data = data or {} }
    function s:readSetting(k, default)
        if self.data[k] == nil and default ~= nil then self.data[k] = default end
        return self.data[k]
    end
    function s:saveSetting(k, v) self.data[k] = v end
    function s:delSetting(k) self.data[k] = nil end
    function s:has(k) return self.data[k] ~= nil end
    function s:isTrue(k) return self.data[k] == true end
    function s:flush() self.flushed = true end
    return s
end

local shown = {}
local events = {}
local stubs = {
    ["ui/widget/buttondialog"] = { new = function(_, o) o.kind = "ButtonDialog" return o end },
    ["ui/widget/confirmbox"] = { new = function(_, o) o.kind = "ConfirmBox" return o end },
    ["ui/widget/infomessage"] = { new = function(_, o) o.kind = "InfoMessage" return o end },
    ["ui/widget/inputdialog"] = { new = function(_, o) o.kind = "InputDialog" return o end },
    ["datastorage"] = { getSettingsDir = function() return tmpdir end },
    ["device"] = {
        model = "Kobo Test",
        screen = { getWidth = function() return 600 end },
        isTouchDevice = function() return true end,
        hasFrontlight = function() return true end,
    },
    ["dispatcher"] = { registered = {}, registerAction = function(self, name, v) self.registered[name] = v end },
    ["docsettings"] = {},
    ["ui/event"] = { new = function(_, name, arg) return { name = name, arg = arg } end },
    ["luasettings"] = { open = function() return fakeSettings() end },
    ["ui/network/manager"] = { isOnline = function() return false end, willRerunWhenOnline = function() return false end },
    ["ui/uimanager"] = {
        show = function(_, w) table.insert(shown, w) end,
        close = function() end,
        forceRePaint = function() end,
        scheduleIn = function() end,
        sendEvent = function(_, ev) table.insert(events, ev) end,
    },
    ["ui/widget/container/widgetcontainer"] = {
        extend = function(self, o)
            o = o or {}
            o.__index = o
            return setmetatable(o, { __index = self })
        end,
    },
    ["libs/libkoreader-lfs"] = {
        attributes = function(path, what)
            local fh = io.open(path, "rb")
            if not fh then return nil end
            fh:close()
            local attr = { mode = "file", size = 1, modification = 1 }
            if what then return attr[what] end
            return attr
        end,
    },
    ["util"] = {
        tableDeepCopy = function(t)
            local c = {}
            for k, v in pairs(t) do c[k] = v end
            return c
        end,
        tableSize = function(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end,
    },
    ["ffi/util"] = {
        template = function(s, ...)
            local args = { ... }
            return (s:gsub("%%(%d)", function(i) return tostring(args[tonumber(i)]) end))
        end,
    },
    ["ui/data/css_tweaks"] = { DEFAULT_GLOBAL_STYLE_TWEAKS = { ["footnote-inpage_epub"] = true } },
}
for name, mod in pairs(stubs) do
    package.loaded[name] = mod
end

G_defaults = fakeSettings({
    DTAP_ZONE_MENU = { x = 0, y = 0, w = 1, h = 1/8 },
    DTAP_ZONE_CONFIG = { x = 0, y = 7/8, w = 1, h = 1/8 },
    DTAP_ZONE_MINIBAR = { x = 0, y = 12/13, w = 1, h = 1/13 },
})

local plugin_dir = (arg and arg[0] or ""):match("^(.*)/[^/]*$") .. "/../readingdashboard.koplugin"
local ReadingDashboard = dofile(plugin_dir .. "/main.lua")

local function newReaderUI()
    local ui = { zones = {}, handled = {}, view_setups = 0 }
    ui.menu = { registerToMainMenu = function(_, p) ui.registered = p end, onShowMenu = function() ui.top_menu = true end }
    ui.document = { file = "/books/x.epub" }
    ui.doc_props = { display_title = "X" }
    ui.view = { footer_visible = true, setupTouchZones = function() ui.view_setups = ui.view_setups + 1 end }
    ui.devicelistener = { onSetNightMode = function(_, on) G_reader_settings:saveSetting("night_mode", on) end }
    ui.rolling = { onGotoViewRel = function(_, diff) ui.turned = diff end }
    ui.config = { onShowConfigMenu = function() ui.config_menu = true end }
    ui.styletweak = { global_tweaks = {}, updateCssText = function(st) st.updated = true end }
    function ui:registerTouchZones(zones) for _, z in ipairs(zones) do self.zones[z.id] = z end end
    function ui:unRegisterTouchZones(zones) for _, z in ipairs(zones) do self.zones[z.id] = nil end end
    function ui:handleEvent(ev) table.insert(self.handled, ev.name) end
    return ui
end

local function newPlugin(path, ui)
    ReadingDashboard.settings_obj = nil
    local p = setmetatable({ path = path, ui = ui, view = ui.view }, { __index = ReadingDashboard })
    p:init()
    return p
end

describe("main", function()
    before_each(function()
        G_reader_settings = fakeSettings({ night_mode = false, page_turns_tap_zones = "default" })
        shown = {}
    end)

    it("registers dispatcher actions and the menu", function()
        local ui = newReaderUI()
        local p = newPlugin(tmpdir .. "/none", ui)
        local Dispatcher = package.loaded["dispatcher"]
        assert_true(Dispatcher.registered.readingdashboard_sync ~= nil)
        assert_eq(Dispatcher.registered.readingdashboard_feel_apply.event, "ReadingDashboardApplyFeel")
        assert_eq(Dispatcher.registered.readingdashboard_feel_restore.event, "ReadingDashboardRestoreFeel")
        local items = {}
        p:addToMainMenu(items)
        local menu = items.reading_dashboard
        assert_eq(menu.sorting_hint, "tools")
        assert_true(#menu.sub_item_table >= 10)
        assert_true(menu.sub_item_table[2].text_func():find("not set") ~= nil)
        assert_true(p.settings.auto_sync)
    end)

    it("pre-fills url and token from defaults.lua without overwriting", function()
        local f = io.open(tmpdir .. "/plugin/defaults.lua", "w")
        f:write('return { url = "https://host/books/", token = "abc123" }')
        f:close()
        local ui = newReaderUI()
        local p = newPlugin(tmpdir .. "/plugin", ui)
        assert_eq(p.settings.url, "https://host/books")
        assert_eq(p.settings.token, "abc123")
        local items = {}
        p:addToMainMenu(items)
        assert_true(items.reading_dashboard.sub_item_table[2].text_func():find("abc123") == nil, "token masked")

        -- A user-set URL is kept; a missing token is still filled in.
        ReadingDashboard.settings_obj = nil
        local p2 = setmetatable({ path = tmpdir .. "/plugin", ui = ui, view = ui.view }, { __index = ReadingDashboard })
        p2:loadSettings()
        p2.settings.url = "https://mine"
        p2.settings.token = nil
        p2:loadBundledDefaults()
        assert_eq(p2.settings.url, "https://mine")
        assert_eq(p2.settings.token, "abc123")
        os.remove(tmpdir .. "/plugin/defaults.lua")
    end)

    it("applies and restores the Moon+ feel, with zones", function()
        local ui = newReaderUI()
        local p = newPlugin(tmpdir .. "/none", ui)
        p:applyFeel()
        assert_eq(G_reader_settings.data.page_turns_tap_zones, "top_bottom")
        assert_true(G_reader_settings.data.night_mode)
        assert_true(ui.zones.readingdashboard_center_tap ~= nil)
        assert_eq(ui.view_setups, 1)
        assert_true(ui.styletweak.updated)

        -- centre tap opens the combined menu
        ui.zones.readingdashboard_center_tap.handler({})
        local dialog = shown[#shown]
        assert_eq(dialog.kind, "ButtonDialog")
        -- footer thirds
        assert_true(ui.zones.readingdashboard_footer_tap.handler({ pos = { x = 10 } }))
        assert_eq(ui.handled[#ui.handled], "ShowBookInfo")
        assert_true(ui.zones.readingdashboard_footer_tap.handler({ pos = { x = 590 } }))
        assert_eq(ui.handled[#ui.handled], "ShowBookmark")
        assert_nil(ui.zones.readingdashboard_footer_tap.handler({ pos = { x = 300 } }), "middle falls through")
        assert_true(ui.zones.readingdashboard_footer_hold.handler({ pos = { x = 10 } }))
        assert_eq(ui.handled[#ui.handled], "ShowFlDialog")
        -- strips turn pages
        ui.zones.readingdashboard_top_tap.handler({})
        assert_eq(ui.turned, -1)
        ui.zones.readingdashboard_bottom_tap.handler({})
        assert_eq(ui.turned, 1)

        -- Applying twice keeps the original snapshot
        p:applyFeel()
        p:restoreFeel()
        assert_eq(G_reader_settings.data.page_turns_tap_zones, "default")
        assert_false(G_reader_settings.data.night_mode)
        assert_nil(G_reader_settings.data.copt_line_spacing)
        assert_nil(G_reader_settings.data.style_tweaks)
        assert_nil(ui.zones.readingdashboard_center_tap)
        assert_nil(p.settings.feel_snapshot)
    end)

    it("re-registers zones on ReaderReady while applied", function()
        local ui = newReaderUI()
        local p = newPlugin(tmpdir .. "/none", ui)
        p.settings.feel_applied = true
        p:onReaderReady()
        assert_true(ui.zones.readingdashboard_center_tap ~= nil)
    end)

    it("records whether the book was new to KOReader", function()
        local ui = newReaderUI()
        local p = newPlugin(tmpdir .. "/none", ui)
        p:onReadSettings(fakeSettings({}))
        assert_false(p.had_status)
        assert_false(p.had_position)
        p:onReadSettings(fakeSettings({ summary = { status = "complete" }, last_xpointer = "/body" }))
        assert_true(p.had_status)
        assert_true(p.had_position)
    end)

    it("asks for configuration before a manual sync", function()
        local ui = newReaderUI()
        local p = newPlugin(tmpdir .. "/none", ui)
        p:sync(true)
        assert_eq(shown[#shown].kind, "InfoMessage")
        assert_true(shown[#shown].text:find("address") ~= nil)
    end)
end)

os.execute("rm -rf '" .. tmpdir .. "'")
