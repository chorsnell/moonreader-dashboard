-- Client tests use a fake transport and a minimal JSON codec, so no network or rapidjson is needed.
package.preload["ltn12"] = package.preload["ltn12"] or function()
    local ltn12 = { sink = {}, source = {} }
    ltn12.sink.table = function(t)
        return function(chunk) if chunk then table.insert(t, chunk) end return 1 end
    end
    ltn12.source.string = function(s)
        local done = false
        return function() if done then return nil end done = true return s end
    end
    ltn12.source.file = function(fh)
        return function()
            local chunk = fh:read(2048)
            if not chunk then fh:close() end
            return chunk
        end
    end
    return ltn12
end
package.preload["libs/libkoreader-lfs"] = function()
    return {
        attributes = function(path, what)
            local fh = io.open(path, "rb")
            if not fh then return nil end
            local size = fh:seek("end")
            fh:close()
            local attr = { mode = "file", size = size }
            if what then return attr[what] end
            return attr
        end,
    }
end

local Client = require("client")

-- Just enough JSON for these tests.
local fakeJSON = {
    encode = function(t) return "ENCODED:" .. tostring(#(t.files or t.books or {})) end,
    decode = function(s)
        if s == '{"ok":true,"books":3}' then return { ok = true, books = 3 } end
        if s == '{"error":"nope"}' then return { error = "nope" } end
        error("bad json")
    end,
}

local function fakeTransport(code, body, capture)
    return function(request, kind)
        capture.request, capture.kind = request, kind
        local chunks = {}
        local src = request.source
        while true do
            local c = src()
            if not c then break end
            table.insert(chunks, c)
        end
        capture.body = table.concat(chunks)
        if code == nil then return nil, nil, "timeout" end
        request.sink(body)
        return code, {}, "HTTP " .. code
    end
end

describe("client", function()
    it("normalises the base URL", function()
        assert_eq(Client.normalizeBase(" https://h.example/books/ "), "https://h.example/books")
        assert_eq(Client.normalizeBase("https://h.example//"), "https://h.example")
        assert_nil(Client.normalizeBase("  "))
    end)

    it("POSTs JSON with the token and decodes the response", function()
        local cap = {}
        local c = Client.new{ base_url = "https://h/books/", token = "secret", json = fakeJSON,
            transport = fakeTransport(200, '{"ok":true,"books":3}', cap) }
        local ok, res, code = c:postJSON("/api/koreader/books", { books = { 1, 2, 3 } })
        assert_true(ok)
        assert_eq(res.books, 3)
        assert_eq(code, 200)
        assert_eq(cap.request.url, "https://h/books/api/koreader/books")
        assert_eq(cap.request.method, "POST")
        assert_eq(cap.request.headers["X-Upload-Token"], "secret")
        assert_eq(cap.request.headers["Content-Type"], "application/json")
        assert_eq(cap.request.headers["Content-Length"], tostring(#cap.body))
    end)

    it("returns the server's error message", function()
        local c = Client.new{ base_url = "https://h", token = "t", json = fakeJSON,
            transport = fakeTransport(400, '{"error":"nope"}', {}) }
        local ok, err, code = c:postJSON("/api/koreader/match", { files = {} })
        assert_false(ok)
        assert_eq(err, "nope")
        assert_eq(code, 400)
    end)

    it("explains auth failures and network errors", function()
        local c = Client.new{ base_url = "https://h", token = "t", json = fakeJSON,
            transport = fakeTransport(401, "", {}) }
        local ok, err = c:postJSON("/x", {})
        assert_false(ok)
        assert_true(err:find("password") ~= nil)
        c = Client.new{ base_url = "https://h", token = "t", json = fakeJSON, transport = fakeTransport(nil, "", {}) }
        ok, err = c:postJSON("/x", {})
        assert_false(ok)
        assert_eq(err, "timeout")
    end)

    it("PUTs a file as a stream with Content-Length and device query", function()
        local tmp = os.tmpname()
        local fh = io.open(tmp, "wb")
        fh:write(string.rep("x", 5000))
        fh:close()
        local cap = {}
        local c = Client.new{ base_url = "https://h/books", token = "t", json = fakeJSON,
            transport = fakeTransport(200, '{"ok":true,"books":3}', cap) }
        local ok = c:putFile("/api/koreader/stats", tmp, { device = "Kobo Libra 2" })
        os.remove(tmp)
        assert_true(ok)
        assert_eq(cap.kind, "file")
        assert_eq(cap.request.method, "PUT")
        assert_eq(cap.request.url, "https://h/books/api/koreader/stats?device=Kobo%20Libra%202")
        assert_eq(cap.request.headers["Content-Length"], "5000")
        assert_eq(cap.request.headers["Content-Type"], "application/octet-stream")
        assert_eq(#cap.body, 5000)
    end)

    it("strips JSON nulls (functions or userdata) recursively", function()
        local t = Client.stripNulls({ a = function() end, b = { c = function() end, d = 1 } })
        assert_nil(t.a)
        assert_nil(t.b.c)
        assert_eq(t.b.d, 1)
    end)
end)
