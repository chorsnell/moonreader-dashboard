-- Tiny self-contained test runner (busted isn't available offline).
-- Usage, from the repo root: luajit koreader/spec/run.lua
-- Exits non-zero when any test fails.

local script_dir = (arg and arg[0] or ""):match("^(.*)/[^/]*$") or "."
local plugin_dir = script_dir .. "/../readingdashboard.koplugin"
-- Plugin modules are required by bare name, like KOReader's PluginLoader does.
package.path = plugin_dir .. "/?.lua;" .. script_dir .. "/?.lua;" .. package.path

-- Stubs for the few KOReader modules the pure code may touch.
package.preload["logger"] = function()
    local noop = function() end
    return { dbg = noop, info = noop, warn = noop, err = noop }
end
package.preload["gettext"] = function()
    return setmetatable({}, { __call = function(_, s) return s end })
end

local results = { passed = 0, failed = 0, failures = {} }
local current = {}
local befores = {}

function describe(name, fn)
    table.insert(current, name)
    table.insert(befores, false)
    fn()
    table.remove(befores)
    table.remove(current)
end

function before_each(fn)
    befores[#befores] = fn
end

function it(name, fn)
    for _, b in ipairs(befores) do
        if b then b() end
    end
    local full = table.concat(current, " > ") .. " > " .. name
    local ok, err = xpcall(fn, debug.traceback)
    if ok then
        results.passed = results.passed + 1
    else
        results.failed = results.failed + 1
        table.insert(results.failures, full .. "\n    " .. tostring(err))
    end
end

local function show(v, depth)
    depth = depth or 0
    if type(v) == "string" then return string.format("%q", v) end
    if type(v) ~= "table" or depth > 3 then return tostring(v) end
    local keys = {}
    for k in pairs(v) do table.insert(keys, k) end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local parts = {}
    for _, k in ipairs(keys) do
        table.insert(parts, tostring(k) .. "=" .. show(v[k], depth + 1))
    end
    return "{" .. table.concat(parts, ", ") .. "}"
end

local function same(a, b)
    if type(a) ~= type(b) then return false end
    if type(a) ~= "table" then return a == b end
    for k, v in pairs(a) do
        if not same(v, b[k]) then return false end
    end
    for k in pairs(b) do
        if a[k] == nil then return false end
    end
    return true
end

function assert_eq(actual, expected, msg)
    if actual ~= expected then
        error((msg and (msg .. ": ") or "") .. "expected " .. show(expected) .. ", got " .. show(actual), 2)
    end
end

function assert_same(actual, expected, msg)
    if not same(actual, expected) then
        error((msg and (msg .. ": ") or "") .. "expected " .. show(expected) .. "\n     got " .. show(actual), 2)
    end
end

function assert_true(v, msg)
    if v ~= true then error((msg or "expected true") .. ", got " .. show(v), 2) end
end

function assert_false(v, msg)
    if v ~= false then error((msg or "expected false") .. ", got " .. show(v), 2) end
end

function assert_nil(v, msg)
    if v ~= nil then error((msg or "expected nil") .. ", got " .. show(v), 2) end
end

local specs = {
    "sidecars_spec",
    "highlights_spec",
    "history_spec",
    "feel_spec",
    "moonplus_spec",
    "client_spec",
    "main_spec",
}

for _, spec in ipairs(specs) do
    local ok, err = xpcall(function() dofile(script_dir .. "/" .. spec .. ".lua") end, debug.traceback)
    if not ok then
        results.failed = results.failed + 1
        table.insert(results.failures, spec .. " (load error)\n    " .. tostring(err))
    end
end

for _, f in ipairs(results.failures) do
    io.stderr:write("FAIL: " .. f .. "\n\n")
end
print(string.format("%d passed, %d failed", results.passed, results.failed))
os.exit(results.failed == 0 and 0 or 1)
