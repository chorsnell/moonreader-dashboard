--[[--
"Moon+ feel": makes KOReader behave like the user's Moon+ Reader setup.

Global settings are changed through a snapshot so "Restore my previous
settings" puts back exactly what was there (including "unset").
Touch zones are only registered in the reader while the feel is applied.

@module readingdashboard.feel
]]

local Feel = {}

-- Settings written to G_reader_settings. Values chosen from the user's Moon+ setup:
-- tap top = previous / bottom = next, no page animation, tiny margins, line spacing,
-- left aligned, no hyphenation, publisher fonts off (Moon+ used DroidSans).
Feel.SETTINGS = {
    page_turns_tap_zones = "top_bottom",
    page_turns_tap_zone_forward_size_ratio = 0.5,
    page_turns_tap_zone_backward_size_ratio = 0.5,
    swipe_animations = false,
    -- Defaults for books opened from now on (creoptions "copt_" prefix)
    copt_h_page_margins = { 10, 10 },
    copt_t_page_margin = 10,
    copt_b_page_margin = 15,
    copt_sync_t_b_page_margins = 0,
    copt_line_spacing = 110, -- DCREREADER_CONFIG_LINE_SPACE_PERCENT_XL_MEDIUM
    copt_embedded_fonts = 0,
    hyphenation = false, -- global default read by ReaderTypography:onReadSettings
}

-- The style tweak lives inside the "style_tweaks" table: handled separately.
Feel.STYLE_TWEAK = "text_align_most_left"
Feel.STYLE_TWEAK_CONFLICTS = { "text_align_all_left", "text_align_most_justify" }

local function deepcopy(v)
    if type(v) ~= "table" then return v end
    local t = {}
    for k, x in pairs(v) do t[k] = deepcopy(x) end
    return t
end
Feel.deepcopy = deepcopy

local function sortedKeys(t)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys)
    return keys
end

--- Snapshots the current values of everything apply() changes.
-- A missing value is stored as { unset = true } so restore can delete it.
-- @param settings LuaSettings-like (readSetting/has)
-- @param default_tweaks table used when "style_tweaks" isn't set (CssTweaks.DEFAULT_GLOBAL_STYLE_TWEAKS)
function Feel.snapshot(settings, extra_keys)
    local snap = { values = {}, version = 1 }
    local keys = sortedKeys(Feel.SETTINGS)
    table.insert(keys, "style_tweaks")
    table.insert(keys, "night_mode")
    for _, k in ipairs(extra_keys or {}) do table.insert(keys, k) end
    for _, k in ipairs(keys) do
        if settings:has(k) then
            snap.values[k] = { value = deepcopy(settings:readSetting(k)) }
        else
            snap.values[k] = { unset = true }
        end
    end
    return snap
end

--- Applies the Moon+ feel settings (not night mode: that goes through an event).
function Feel.apply(settings, default_tweaks)
    for _, k in ipairs(sortedKeys(Feel.SETTINGS)) do
        settings:saveSetting(k, deepcopy(Feel.SETTINGS[k]))
    end
    local tweaks = deepcopy(settings:readSetting("style_tweaks") or default_tweaks or {})
    for _, id in ipairs(Feel.STYLE_TWEAK_CONFLICTS) do
        tweaks[id] = nil
    end
    tweaks[Feel.STYLE_TWEAK] = true
    settings:saveSetting("style_tweaks", tweaks)
end

--- Restores a snapshot exactly. Night mode is returned rather than written,
-- so the caller can switch it via the SetNightMode event.
-- @treturn bool previous night mode (true/false)
function Feel.restore(settings, snap)
    local night
    for k, entry in pairs(snap.values or {}) do
        if k == "night_mode" then
            night = entry.value == true
        elseif entry.unset then
            settings:delSetting(k)
        else
            settings:saveSetting(k, deepcopy(entry.value))
        end
    end
    return night or false
end

-- Touch zones ---------------------------------------------------------------

Feel.CENTER_ZONE = { ratio_x = 1/4, ratio_y = 1/3, ratio_w = 1/2, ratio_h = 1/3 }

--- Builds the touch zone definitions.
-- @param defaults G_defaults-like (readSetting) for DTAP_ZONE_* values
-- @param handlers { center = fn, prev = fn, next = fn, footer_tap = fn(ges), footer_hold = fn(ges) }
function Feel.buildZones(defaults, handlers)
    local menu = defaults:readSetting("DTAP_ZONE_MENU")
    local config = defaults:readSetting("DTAP_ZONE_CONFIG")
    local minibar = defaults:readSetting("DTAP_ZONE_MINIBAR")
    return {
        {
            id = "readingdashboard_center_tap",
            ges = "tap",
            screen_zone = Feel.CENTER_ZONE,
            overrides = {
                "tap_forward", "tap_backward",
                "readermenu_tap", "readermenu_ext_tap",
                "readerconfigmenu_tap", "readerconfigmenu_ext_tap",
            },
            handler = function(ges) return handlers.center(ges) end,
        },
        {
            -- Top strip turns back instead of opening the top menu (swipe down still opens it).
            id = "readingdashboard_top_tap",
            ges = "tap",
            screen_zone = {
                ratio_x = menu.x, ratio_y = menu.y, ratio_w = menu.w, ratio_h = math.max(menu.h, 1/5),
            },
            overrides = { "readermenu_tap", "readermenu_ext_tap" },
            handler = function(ges) return handlers.prev(ges) end,
        },
        {
            -- Bottom strip turns forward instead of opening the bottom menu (swipe up still opens it).
            -- Placed above the status bar zone so footer taps keep working.
            id = "readingdashboard_bottom_tap",
            ges = "tap",
            screen_zone = {
                ratio_x = config.x, ratio_y = math.min(config.y, 4/5),
                ratio_w = config.w, ratio_h = minibar.y - math.min(config.y, 4/5),
            },
            overrides = { "readerconfigmenu_tap", "readerconfigmenu_ext_tap" },
            handler = function(ges) return handlers.next(ges) end,
        },
        {
            id = "readingdashboard_footer_tap",
            ges = "tap",
            screen_zone = {
                ratio_x = minibar.x, ratio_y = minibar.y, ratio_w = minibar.w, ratio_h = minibar.h,
            },
            overrides = {
                "readerfooter_tap",
                "readerconfigmenu_tap", "readerconfigmenu_ext_tap",
                "tap_forward", "tap_backward",
            },
            -- Returning nil in the middle third falls through to KOReader's footer handler.
            handler = function(ges) return handlers.footer_tap(ges) end,
        },
        {
            id = "readingdashboard_footer_hold",
            ges = "hold",
            screen_zone = {
                ratio_x = minibar.x, ratio_y = minibar.y, ratio_w = minibar.w, ratio_h = minibar.h,
            },
            overrides = { "readerfooter_hold", "readerhighlight_hold" },
            handler = function(ges) return handlers.footer_hold(ges) end,
        },
    }
end

--- Which third of the screen width a gesture is in: "left", "middle", "right".
function Feel.third(x, width)
    if x < width / 3 then return "left" end
    if x >= width * 2 / 3 then return "right" end
    return "middle"
end

return Feel
