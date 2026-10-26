local History = require("history")

-- In-memory stand-in for the statistics DB adapter.
local function fakeStore()
    local store = { books = {}, rows = {}, next_id = 1, totals_updated = {} }
    function store:existingDates(id_book)
        local dates = {}
        for _, r in ipairs(self.rows) do
            if r.id_book == id_book then dates[os.date("%Y-%m-%d", r.start_time)] = true end
        end
        return dates
    end
    function store:insertRows(id_book, rows)
        local n = 0
        for _, r in ipairs(rows) do
            local dup = false
            for _, e in ipairs(self.rows) do
                -- UNIQUE (id_book, page, start_time) + INSERT OR IGNORE
                if e.id_book == id_book and e.page == r.page and e.start_time == r.start_time then dup = true end
            end
            if not dup then
                table.insert(self.rows, { id_book = id_book, page = r.page, start_time = r.start_time,
                    duration = r.duration, total_pages = r.total_pages })
                n = n + 1
            end
        end
        return n
    end
    function store:updateTotals(id_book) self.totals_updated[id_book] = true end
    function store:findOrCreateBook(title, authors, md5)
        for id, b in pairs(self.books) do
            if b.md5 == md5 then return id end
        end
        local id = self.next_id
        self.next_id = id + 1
        self.books[id] = { title = title, authors = authors, md5 = md5, pages = 100 }
        return id
    end
    return store
end

describe("history", function()
    it("starts at local noon", function()
        local t = History.localNoon("2024-03-01")
        local d = os.date("*t", t)
        assert_eq(d.year, 2024)
        assert_eq(d.month, 3)
        assert_eq(d.day, 1)
        assert_eq(d.hour, 12)
        assert_eq(d.min, 0)
        assert_nil(History.localNoon("garbage"))
    end)

    it("maps progress to a page between 1 and 100", function()
        assert_eq(History.pageFromProgress(nil), 1)
        assert_eq(History.pageFromProgress(0), 1)
        assert_eq(History.pageFromProgress(18.2), 18)
        assert_eq(History.pageFromProgress(99.6), 100)
        assert_eq(History.pageFromProgress(250), 100)
    end)

    it("splits a day into at most one-hour rows an hour apart", function()
        local rows = History.rowsForDay({ date = "2024-03-01", minutes = 150.5, progress = 42 })
        local noon = History.localNoon("2024-03-01")
        assert_eq(#rows, 3)
        assert_same(rows[1], { page = 42, start_time = noon, duration = 3600, total_pages = 100 })
        assert_same(rows[2], { page = 42, start_time = noon + 3600, duration = 3600, total_pages = 100 })
        assert_same(rows[3], { page = 42, start_time = noon + 7200, duration = 1830, total_pages = 100 })
    end)

    it("makes one row for a short day and none for an empty one", function()
        local rows = History.rowsForDay({ date = "2024-03-02", minutes = 42.5, progress = 18.2 })
        assert_eq(#rows, 1)
        assert_eq(rows[1].duration, 2550)
        assert_eq(rows[1].page, 18)
        assert_eq(#History.rowsForDay({ date = "2024-03-02", minutes = 0 }), 0)
    end)

    it("skips dates the book already has and duplicate dates", function()
        local days = {
            { date = "2024-03-01", minutes = 10, progress = 1 },
            { date = "2024-03-02", minutes = 10, progress = 2 },
            { date = "2024-03-02", minutes = 99, progress = 3 },
        }
        local rows, used = History.planRows(days, { ["2024-03-01"] = true })
        assert_eq(used, 1)
        assert_eq(#rows, 1)
        assert_eq(rows[1].page, 2)
    end)

    it("applies days to a book through the store, idempotently", function()
        local store = fakeStore()
        local id = store:findOrCreateBook("T", "A", "real-md5")
        -- The book already has a real KOReader session on 2024-03-01
        table.insert(store.rows, { id_book = id, page = 5, start_time = History.localNoon("2024-03-01") + 7 * 3600,
            duration = 60, total_pages = 300 })
        local days = {
            { date = "2024-03-01", minutes = 30, progress = 10 },
            { date = "2024-03-03", minutes = 70, progress = 20 },
        }
        local inserted, used = History.applyDays(store, id, days)
        assert_eq(used, 1)
        assert_eq(inserted, 2)
        assert_true(store.totals_updated[id])
        local again = History.applyDays(store, id, days)
        assert_eq(again, 0, "second run adds nothing")
    end)

    it("names books not on the device moonplus:<id> with KOReader authors", function()
        assert_eq(History.moonplusMD5("abc"), "moonplus:abc")
        assert_eq(History.koreaderAuthors("Author One & Author Two"), "Author One\nAuthor Two")
        assert_eq(History.koreaderAuthors(nil), "N/A")
    end)

    it("imports others once, counting books and days", function()
        local others = {
            { id = "b1", title = "Gone", author = "A & B",
              days = { { date = "2023-01-01", minutes = 20, progress = 5 }, { date = "2023-01-02", minutes = 0 } } },
            { id = "b2", title = "Empty", author = "C", days = {} },
        }
        local nb_books, nb_days = History.countOthers(others)
        assert_eq(nb_books, 1)
        assert_eq(nb_days, 1)
        local store = fakeStore()
        local books, days, rows = History.importOthers(store, others)
        assert_eq(books, 1)
        assert_eq(days, 1)
        assert_eq(rows, 1)
        assert_eq(store.books[1].md5, "moonplus:b1")
        assert_eq(store.books[1].authors, "A\nB")
        History.importOthers(store, others)
        local count = 0
        for _ in pairs(store.books) do count = count + 1 end
        assert_eq(count, 1, "no duplicate book row")
        assert_eq(#store.rows, 1, "no duplicate rows")
    end)
end)
