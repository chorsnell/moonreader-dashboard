local MoonPlus = require("moonplus")

describe("moon+ apply", function()
    it("recognises supported book files", function()
        assert_true(MoonPlus.isSupported("/a/B.EPUB"))
        assert_true(MoonPlus.isSupported("x.azw3"))
        assert_false(MoonPlus.isSupported("notes.md"))
        assert_false(MoonPlus.isSupported("noext"))
    end)

    it("jumps only for books new to KOReader when the dashboard is ahead", function()
        local m = { progress = 63.5 }
        assert_eq(MoonPlus.progressTarget(m, false, 0), 63.5)
        assert_nil(MoonPlus.progressTarget(m, true, 0), "had a position")
        assert_nil(MoonPlus.progressTarget(m, false, 70), "KOReader ahead")
        assert_nil(MoonPlus.progressTarget({ progress = nil }, false, 0))
        assert_eq(MoonPlus.progressTarget({ progress = 120 }, false, 0), 100)
    end)

    it("marks finished only when KOReader had no status", function()
        assert_true(MoonPlus.shouldMarkComplete({ status = "finished" }, false))
        assert_false(MoonPlus.shouldMarkComplete({ status = "finished" }, true))
        assert_false(MoonPlus.shouldMarkComplete({ status = "in_progress" }, false))
    end)

    it("builds sidecars for unopened books", function()
        local d = MoonPlus.unopenedSidecar({ progress = 40, status = "in_progress" }, "m")
        assert_eq(d.last_percent, 0.4)
        assert_eq(d.percent_finished, 0.4)
        assert_eq(d.partial_md5_checksum, "m")
        assert_nil(d.summary)
        d = MoonPlus.unopenedSidecar({ progress = nil, status = "finished" }, "m")
        assert_eq(d.percent_finished, 1)
        assert_eq(d.summary.status, "complete")
        assert_nil(MoonPlus.unopenedSidecar({ progress = nil, status = "unknown" }, "m"))
    end)

    it("names collections after the genre", function()
        assert_eq(MoonPlus.collectionName({ genre = " Science Fiction " }), "Science Fiction")
        assert_nil(MoonPlus.collectionName({ genre = "" }))
        assert_nil(MoonPlus.collectionName({}))
    end)

    it("builds match entries with base names", function()
        assert_same(MoonPlus.matchFile("m", "/mnt/us/Books/A.epub", "T", "A"),
            { md5 = "m", file = "A.epub", title = "T", authors = "A" })
    end)

    it("matches in batches and asks for others once", function()
        local files = {}
        for i = 1, 230 do files[i] = MoonPlus.matchFile("md5-" .. i, "/b" .. i .. ".epub") end
        local bodies = {}
        local post = function(body)
            table.insert(bodies, body)
            local books = {}
            for _, f in ipairs(body.files) do
                local n = tonumber(f.md5:match("%d+$"))
                table.insert(books, { md5 = f.md5, match = (n % 2 == 0) and { id = "id" .. n } or nil })
            end
            return true, { books = books, others = body.others and { { id = "id200", days = {} }, { id = "zz", days = {} } } or {} }
        end
        local ok, by_md5, others = MoonPlus.matchAll(post, files, true, 100)
        assert_true(ok)
        assert_eq(#bodies, 3)
        assert_eq(#bodies[1].files, 100)
        assert_eq(#bodies[3].files, 30)
        assert_true(bodies[1].others)
        assert_nil(bodies[2].others)
        assert_eq(by_md5["md5-2"].id, "id2")
        assert_nil(by_md5["md5-3"])
        -- id200 matched a file in a later batch, so it isn't "not on this device"
        assert_eq(#others, 1)
        assert_eq(others[1].id, "zz")
    end)

    it("stops on the first failed batch", function()
        local ok, _, err = MoonPlus.matchAll(function() return false, "boom" end, { MoonPlus.matchFile("m", "/x") }, false)
        assert_false(ok)
        assert_eq(err, "boom")
    end)
end)
