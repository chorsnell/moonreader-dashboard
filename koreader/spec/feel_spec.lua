local Feel = require("feel")

-- LuaSettings-like fake (same semantics as frontend/luasettings.lua).
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
    return s
end

local function deepcopy(v) return Feel.deepcopy(v) end

describe("moon+ feel", function()
    it("applies the Moon+ settings", function()
        local s = fakeSettings()
        Feel.apply(s, { ["footnote-inpage_epub"] = true })
        assert_eq(s.data.page_turns_tap_zones, "top_bottom")
        assert_eq(s.data.page_turns_tap_zone_forward_size_ratio, 0.5)
        assert_eq(s.data.page_turns_tap_zone_backward_size_ratio, 0.5)
        assert_false(s.data.swipe_animations)
        assert_same(s.data.copt_h_page_margins, { 10, 10 })
        assert_eq(s.data.copt_t_page_margin, 10)
        assert_eq(s.data.copt_b_page_margin, 15)
        assert_eq(s.data.copt_sync_t_b_page_margins, 0)
        assert_eq(s.data.copt_line_spacing, 110)
        assert_eq(s.data.copt_embedded_fonts, 0)
        assert_false(s.data.hyphenation)
        assert_same(s.data.style_tweaks, { ["footnote-inpage_epub"] = true, text_align_most_left = true })
    end)

    it("removes conflicting alignment tweaks", function()
        local s = fakeSettings({ style_tweaks = { text_align_most_justify = true, other = true } })
        Feel.apply(s)
        assert_same(s.data.style_tweaks, { other = true, text_align_most_left = true })
    end)

    it("round-trips snapshot -> apply -> restore exactly", function()
        local original = {
            page_turns_tap_zones = "left_right",
            swipe_animations = true,
            copt_line_spacing = 100,
            style_tweaks = { text_align_most_justify = true },
            night_mode = false,
            unrelated = "keep me",
        }
        local s = fakeSettings(deepcopy(original))
        local snap = Feel.snapshot(s)
        Feel.apply(s)
        s:saveSetting("night_mode", true) -- what SetNightMode does
        assert_eq(s.data.page_turns_tap_zones, "top_bottom")
        local night = Feel.restore(s, snap)
        assert_false(night, "night mode returned for the event")
        s:saveSetting("night_mode", night)
        assert_same(s.data, original)
    end)

    it("restores unset settings by deleting them", function()
        local s = fakeSettings({})
        local snap = Feel.snapshot(s)
        Feel.apply(s, { ["footnote-inpage_epub"] = true })
        Feel.restore(s, snap)
        assert_same(s.data, {})
    end)

    it("snapshot is not aliased to live tables", function()
        local s = fakeSettings({ copt_h_page_margins = { 15, 15 } })
        local snap = Feel.snapshot(s)
        s.data.copt_h_page_margins[1] = 99
        assert_same(snap.values.copt_h_page_margins.value, { 15, 15 })
    end)

    it("builds touch zones that override KOReader's menu and footer zones", function()
        local defaults = fakeSettings({
            DTAP_ZONE_MENU = { x = 0, y = 0, w = 1, h = 1/8 },
            DTAP_ZONE_CONFIG = { x = 0, y = 7/8, w = 1, h = 1/8 },
            DTAP_ZONE_MINIBAR = { x = 0, y = 12/13, w = 1, h = 1/13 },
        })
        local calls = {}
        local zones = Feel.buildZones(defaults, {
            center = function() calls.center = true return true end,
            prev = function() calls.prev = true return true end,
            next = function() calls.next = true return true end,
            footer_tap = function() return nil end,
            footer_hold = function() return nil end,
        })
        local by_id = {}
        for _, z in ipairs(zones) do by_id[z.id] = z end
        local center = by_id.readingdashboard_center_tap
        assert_same(center.screen_zone, { ratio_x = 1/4, ratio_y = 1/3, ratio_w = 1/2, ratio_h = 1/3 })
        for _, id in ipairs({ "tap_forward", "tap_backward", "readermenu_tap", "readermenu_ext_tap",
                              "readerconfigmenu_tap", "readerconfigmenu_ext_tap" }) do
            local found = false
            for _, o in ipairs(center.overrides) do if o == id then found = true end end
            assert_true(found, "center overrides " .. id)
        end
        assert_true(center.handler({}))
        by_id.readingdashboard_top_tap.handler({})
        by_id.readingdashboard_bottom_tap.handler({})
        assert_true(calls.prev and calls.next)
        local bottom = by_id.readingdashboard_bottom_tap.screen_zone
        assert_true(bottom.ratio_y + bottom.ratio_h <= 12/13 + 1e-9, "bottom strip stops above the status bar")
        for _, z in ipairs(zones) do assert_true(z.ges == "tap" or z.ges == "hold", "no swipe zones") end
    end)

    it("splits the status bar into thirds", function()
        assert_eq(Feel.third(10, 300), "left")
        assert_eq(Feel.third(150, 300), "middle")
        assert_eq(Feel.third(290, 300), "right")
    end)
end)
