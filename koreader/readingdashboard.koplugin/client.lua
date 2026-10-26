--[[--
HTTP client for the reading dashboard (see koreader/API.md).

Follows the wallabag/exporter plugins: socket.http + ltn12 with socketutil
timeouts (socket.http handles https:// URLs through LuaSec in KOReader),
rapidjson for (de)serialisation. The transport and JSON codec can be swapped
so the request building is unit-testable without a network stack.

@module readingdashboard.client
]]

local Client = {}
Client.__index = Client

--- Trims whitespace and trailing slashes so "{base}/api/..." never has "//".
function Client.normalizeBase(url)
    if type(url) ~= "string" then return nil end
    url = url:gsub("^%s+", ""):gsub("%s+$", ""):gsub("/+$", "")
    if url == "" then return nil end
    return url
end

--- Minimal percent-encoding for query values (device names have spaces).
function Client.encodeQuery(value)
    return (tostring(value):gsub("[^%w%-%._~]", function(c)
        return string.format("%%%02X", c:byte())
    end))
end

--- @param o table { base_url = string, token = string, transport = fn?, json = codec?, timeouts = table? }
function Client.new(o)
    local self = setmetatable({}, Client)
    self.base_url = Client.normalizeBase(o.base_url)
    self.token = o.token
    self.transport = o.transport
    self.json = o.json
    self.socketutil = o.socketutil
    return self
end

function Client:getJSON()
    if not self.json then
        self.json = require("json")
    end
    return self.json
end

-- KOReader's json decodes null as a function (see wallabag), rapidjson as userdata: turn both into nil
-- recursively so callers can use plain `if x then` checks.
local function stripNulls(v)
    local t = type(v)
    if t == "table" then
        for k, val in pairs(v) do
            local tv = type(val)
            if tv == "userdata" or tv == "function" then
                v[k] = nil
            elseif tv == "table" then
                stripNulls(val)
            end
        end
        return v
    elseif t == "userdata" or t == "function" then
        return nil
    end
    return v
end
Client.stripNulls = stripNulls

--- Default transport: LuaSocket with KOReader's socketutil timeouts.
-- Returns code, headers, status (like socket.skip(1, http.request(...))).
function Client:defaultTransport(request, kind)
    local http = require("socket.http")
    local socket = require("socket")
    local socketutil = self.socketutil or require("socketutil")
    local block, total
    if kind == "file" then
        block, total = socketutil:set_timeout(socketutil.FILE_BLOCK_TIMEOUT, socketutil.FILE_TOTAL_TIMEOUT)
    else
        block, total = socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    end
    local code, headers, status = socket.skip(1, http.request(request))
    socketutil:reset_timeout()
    if headers == nil then
        -- Network-level failure: code is LuaSocket's error string
        local described = socketutil.describe_error and socketutil.describe_error(code, block, total)
        return nil, nil, described or tostring(status or code or "network unreachable")
    end
    return code, headers, status
end

function Client:url(path, query)
    local url = self.base_url .. path
    if query then
        local parts = {}
        for k, v in pairs(query) do
            table.insert(parts, k .. "=" .. Client.encodeQuery(v))
        end
        table.sort(parts)
        if #parts > 0 then
            url = url .. "?" .. table.concat(parts, "&")
        end
    end
    return url
end

-- Shared response handling. Returns ok, data_or_error, http_code.
function Client:handleResponse(code, status, sink)
    if code == nil then
        return false, status or "network error", nil
    end
    local content = table.concat(sink)
    local data
    if content ~= "" then
        local ok, decoded = pcall(self:getJSON().decode, content)
        if ok and type(decoded) == "table" then
            data = stripNulls(decoded)
        end
    end
    if code == 200 then
        if not data then
            return false, "The dashboard sent a response that isn't JSON.", code
        end
        return true, data, code
    end
    local message = data and data.error
    if not message then
        if code == 401 or code == 403 then
            message = "The dashboard rejected the admin password."
        elseif code == 404 then
            message = "Not found: check the dashboard address."
        else
            message = "HTTP " .. tostring(code)
        end
    end
    return false, message, code
end

local function makeSink(self, sink)
    local ltn12 = require("ltn12")
    local socketutil = self.socketutil or (not self.transport and require("socketutil"))
    if socketutil and socketutil.table_sink then
        return socketutil.table_sink(sink)
    end
    return ltn12.sink.table(sink)
end

--- POST a JSON body. Returns ok, decoded_response_or_error, http_code.
function Client:postJSON(path, body)
    local json = self:getJSON()
    local ok_enc, body_json = pcall(json.encode, body)
    if not ok_enc or type(body_json) ~= "string" then
        return false, "Could not encode the request."
    end
    local ltn12 = require("ltn12")
    local sink = {}
    local request = {
        url = self:url(path),
        method = "POST",
        sink = makeSink(self, sink),
        source = ltn12.source.string(body_json),
        headers = {
            ["Content-Type"] = "application/json",
            ["Content-Length"] = tostring(#body_json),
            ["Accept"] = "application/json",
            ["X-Upload-Token"] = self.token,
        },
    }
    local transport = self.transport or function(r, k) return self:defaultTransport(r, k) end
    local code, _, status = transport(request, "json")
    return self:handleResponse(code, status, sink)
end

--- PUT a file as application/octet-stream, streamed from disk.
function Client:putFile(path, filepath, query)
    local lfs = require("libs/libkoreader-lfs")
    local size = lfs.attributes(filepath, "size")
    local fh = size and io.open(filepath, "rb")
    if not fh then
        return false, "Can't read " .. tostring(filepath)
    end
    local ltn12 = require("ltn12")
    local sink = {}
    local request = {
        url = self:url(path, query),
        method = "PUT",
        sink = makeSink(self, sink),
        -- ltn12.source.file closes the handle when it reaches EOF
        source = ltn12.source.file(fh),
        headers = {
            ["Content-Type"] = "application/octet-stream",
            ["Content-Length"] = tostring(size),
            ["Accept"] = "application/json",
            ["X-Upload-Token"] = self.token,
        },
    }
    local transport = self.transport or function(r, k) return self:defaultTransport(r, k) end
    local code, _, status = transport(request, "file")
    return self:handleResponse(code, status, sink)
end

return Client
