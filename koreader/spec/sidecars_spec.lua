local Sidecars = require("sidecars")

describe("sidecars", function()
    local sidecar = {
        partial_md5_checksum = "abc123",
        doc_props = { title = "Dune", authors = "Frank Herbert", series = "Dune", series_index = 1 },
        doc_pages = 612,
        percent_finished = 0.42,
        summary = { status = "reading", modified = "2026-10-25" },
        annotations = {
            { text = "Fear is the mind-killer.", note = "classic", datetime = "2026-10-20 22:01:00",
              chapter = "Chapter 1", pageno = 12, drawer = "lighten", color = "yellow", page = "/body/p[1]" },
            { text = "in Chapter 2", datetime = "2026-10-21 08:00:00", chapter = "Chapter 2", pageno = 40, page = "/body/p[9]" },
        },
    }

    it("builds the API book from a sidecar table", function()
        local book = Sidecars.buildBook(sidecar, "/mnt/onboard/Books/Dune.epub")
        assert_eq(book.md5, "abc123")
        assert_eq(book.file, "Dune.epub")
        assert_eq(book.title, "Dune")
        assert_eq(book.authors, "Frank Herbert")
        assert_eq(book.series, "Dune #1")
        assert_eq(book.pages, 612)
        assert_eq(book.percent, 0.42)
        assert_eq(book.status, "reading")
        assert_eq(book.modified, "2026-10-25")
        assert_eq(#book.annotations, 2)
        assert_same(book.annotations[1], {
            text = "Fear is the mind-killer.", note = "classic", datetime = "2026-10-20 22:01:00",
            chapter = "Chapter 1", pageno = 12, drawer = "lighten", color = "yellow",
        })
        assert_nil(book.annotations[2].drawer, "page bookmark has no drawer")
        assert_nil(book.annotations[2].note)
    end)

    it("falls back to the file name, partial md5 and drops unknown status", function()
        local book = Sidecars.buildBook({ summary = { status = "weird" }, stats = { authors = "N/A", pages = 0 } },
            "/books/Some Book.fb2", "md5x")
        assert_eq(book.md5, "md5x")
        assert_eq(book.title, "Some Book")
        assert_nil(book.authors)
        assert_nil(book.status)
        assert_nil(book.pages)
        assert_nil(book.percent)
        assert_same(book.annotations, {})
    end)

    it("prefers custom metadata (Book information edits)", function()
        local book = Sidecars.buildBook({ partial_md5_checksum = "m", doc_props = { title = "a" },
            custom_props = { title = "Better", authors = "X\nY" } }, "/b.epub")
        assert_eq(book.title, "Better")
        assert_eq(book.authors, "X\nY")
    end)

    it("returns nil without an md5", function()
        assert_nil(Sidecars.buildBook({}, "/x.epub"))
    end)

    it("batches lists", function()
        local list = {}
        for i = 1, 250 do list[i] = i end
        local b = Sidecars.batches(list, 100)
        assert_eq(#b, 3)
        assert_eq(#b[1], 100)
        assert_eq(#b[3], 50)
        assert_eq(b[3][50], 250)
        assert_eq(#Sidecars.batches({}, 100), 0)
    end)

    it("selects changed sidecars, all on first sync, skipping missing files", function()
        local entries = {
            { file = "/a.epub", exists = true, sidecar = "/a.sdr/m.lua", mtime = 10 },
            { file = "/b.epub", exists = true, sidecar = "/b.sdr/m.lua", mtime = 20 },
            { file = "/c.epub", exists = false, sidecar = nil },
            { file = "/d.epub", exists = true, sidecar = nil },
        }
        assert_eq(#Sidecars.changedEntries(entries, nil), 2)
        local changed = Sidecars.changedEntries(entries, { ["/a.epub"] = 10, ["/b.epub"] = 19 })
        assert_eq(#changed, 1)
        assert_eq(changed[1].file, "/b.epub")
    end)

    it("uploads stats only when size or mtime changed", function()
        assert_true(Sidecars.statsChanged({ size = 1, modification = 2 }, nil))
        assert_false(Sidecars.statsChanged({ size = 1, modification = 2 }, { size = 1, modification = 2 }))
        assert_true(Sidecars.statsChanged({ size = 1, modification = 3 }, { size = 1, modification = 2 }))
        assert_false(Sidecars.statsChanged(nil, nil))
    end)
end)
