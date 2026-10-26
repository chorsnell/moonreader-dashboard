--[[--
Writes Moon+ (and other non-KOReader) reading days into KOReader's statistics
database as synthetic page_stat_data rows (API.md "Synthetic history rows").

Pure planning (`rowsForDay`, `planRows`) is separate from the database adapter
(`History.openDB`) so the row maths can be tested against a fake store.

@module readingdashboard.history
]]

local History = {
    TOTAL_PAGES = 100,
    MAX_ROW_SECONDS = 3600,
    MOONPLUS_PREFIX = "moonplus:",
}

--- "YYYY-MM-DD" -> timestamp of local noon that day (nil if malformed).
function History.localNoon(date)
    local y, m, d = tostring(date or ""):match("^(%d%d%d%d)-(%d%d)-(%d%d)")
    if not y then return nil end
    -- isdst = nil lets mktime work out DST for that date
    return os.time{ year = tonumber(y), month = tonumber(m), day = tonumber(d), hour = 12, min = 0, sec = 0 }
end

function History.localDate(ts)
    return os.date("%Y-%m-%d", ts)
end

--- Page (1..100) for a day's progress (0..100, may be nil).
function History.pageFromProgress(progress)
    local p = tonumber(progress)
    if not p then return 1 end
    p = math.floor(p + 0.5)
    if p < 1 then p = 1 end
    if p > History.TOTAL_PAGES then p = History.TOTAL_PAGES end
    return p
end

--- Rows for one dashboard day: starting at local noon, each at most an hour,
-- later ones an hour apart.
-- @treturn array of { page, start_time, duration, total_pages }
function History.rowsForDay(day)
    local noon = History.localNoon(day and day.date)
    local seconds = math.floor((tonumber(day and day.minutes) or 0) * 60 + 0.5)
    local rows = {}
    if not noon or seconds <= 0 then return rows end
    local page = History.pageFromProgress(day.progress)
    local start = noon
    while seconds > 0 do
        local duration = math.min(seconds, History.MAX_ROW_SECONDS)
        table.insert(rows, {
            page = page,
            start_time = start,
            duration = duration,
            total_pages = History.TOTAL_PAGES,
        })
        seconds = seconds - duration
        start = start + History.MAX_ROW_SECONDS
    end
    return rows
end

--- Rows for all of a book's days, skipping dates it already has stats for.
-- @param days array of { date, minutes, progress }
-- @param existing_dates set { ["YYYY-MM-DD"] = true }
-- @treturn rows, number of days used
function History.planRows(days, existing_dates)
    existing_dates = existing_dates or {}
    local rows, used, seen = {}, 0, {}
    for _, day in ipairs(days or {}) do
        local date = day.date
        if date and not existing_dates[date] and not seen[date] then
            local day_rows = History.rowsForDay(day)
            if #day_rows > 0 then
                seen[date] = true
                used = used + 1
                for _, r in ipairs(day_rows) do table.insert(rows, r) end
            end
        end
    end
    return rows, used
end

function History.moonplusMD5(id)
    return History.MOONPLUS_PREFIX .. tostring(id)
end

--- Dashboard "A & B" -> KOReader's newline-separated authors.
function History.koreaderAuthors(author)
    if type(author) ~= "string" or author == "" then return "N/A" end
    return (author:gsub("%s+&%s+", "\n"))
end

--- Counts what an import of `others` would add (for the confirmation box).
function History.countOthers(others)
    local books, days = 0, 0
    for _, b in ipairs(others or {}) do
        local n = 0
        for _, d in ipairs(b.days or {}) do
            if (tonumber(d.minutes) or 0) > 0 and History.localNoon(d.date) then n = n + 1 end
        end
        if n > 0 then
            books = books + 1
            days = days + n
        end
    end
    return books, days
end

--- Applies days to one book through a store (real DB adapter or fake).
-- store must implement existingDates(id_book), insertRows(id_book, rows) -> inserted,
-- updateTotals(id_book).
-- @treturn inserted rows, days used, rows array actually planned
function History.applyDays(store, id_book, days)
    local rows, used = History.planRows(days, store:existingDates(id_book))
    if #rows == 0 then return 0, 0, rows end
    local inserted = store:insertRows(id_book, rows)
    store:updateTotals(id_book)
    return inserted, used, rows
end

--- Imports `others` (books not on the device) under "moonplus:<id>" rows.
-- store must also implement findOrCreateBook(title, authors, md5, last_open) -> id.
function History.importOthers(store, others)
    local books, days, rows_total = 0, 0, 0
    for _, b in ipairs(others or {}) do
        if b.id and b.days and #b.days > 0 then
            local last_open
            for _, d in ipairs(b.days) do
                local t = History.localNoon(d.date)
                if t and (not last_open or t > last_open) then last_open = t end
            end
            local id_book = store:findOrCreateBook(b.title or "Unknown", History.koreaderAuthors(b.author),
                History.moonplusMD5(b.id), last_open or os.time())
            if id_book then
                local inserted, used = History.applyDays(store, id_book, b.days)
                if used > 0 then
                    books = books + 1
                    days = days + used
                    rows_total = rows_total + inserted
                end
            end
        end
    end
    return books, days, rows_total
end

-- SQLite adapter (KOReader only) --------------------------------------------

local DBStore = {}
DBStore.__index = DBStore

--- Opens the stats DB, backing it up once before the first write ever.
function History.openDB(db_path)
    local lfs = require("libs/libkoreader-lfs")
    if lfs.attributes(db_path, "mode") ~= "file" then
        return nil, "KOReader's reading statistics database doesn't exist yet."
    end
    local SQ3 = require("lua-ljsqlite3/init")
    local conn = SQ3.open(db_path)
    return setmetatable({ conn = conn, path = db_path }, DBStore)
end

-- @param store optional open DBStore: the statistics DB is in WAL mode on most devices, so
-- recent sessions live in statistics.sqlite3-wal until a checkpoint; copying the main file
-- alone would back up a database missing them.
function History.backupOnce(db_path, store)
    local lfs = require("libs/libkoreader-lfs")
    local bak = db_path .. ".readingdashboard.bak"
    if lfs.attributes(bak, "mode") ~= "file" then
        if store and store.conn then
            pcall(store.conn.exec, store.conn, "PRAGMA wal_checkpoint(TRUNCATE);")
        end
        require("ffi/util").copyFile(db_path, bak)
        return bak
    end
end

function DBStore:close()
    if self.conn then
        self.conn:close()
        self.conn = nil
    end
end

function DBStore:existingDates(id_book)
    local stmt = self.conn:prepare([[
        SELECT DISTINCT date(start_time, 'unixepoch', 'localtime')
        FROM   page_stat_data
        WHERE  id_book = ?;
    ]])
    local res, nb = stmt:reset():bind(id_book):resultset("i")
    stmt:close()
    local dates = {}
    for i = 1, (nb or 0) do
        dates[res[1][i]] = true
    end
    return dates
end

function DBStore:insertRows(id_book, rows)
    local before = tonumber(self.conn:rowexec("SELECT total_changes();")) or 0
    self.conn:exec("BEGIN;")
    local stmt = self.conn:prepare("INSERT OR IGNORE INTO page_stat_data VALUES(?, ?, ?, ?, ?);")
    for _, r in ipairs(rows) do
        stmt:reset():bind(id_book, r.page, r.start_time, r.duration, r.total_pages):step()
    end
    stmt:close()
    self.conn:exec("COMMIT;")
    local after = tonumber(self.conn:rowexec("SELECT total_changes();")) or 0
    return after - before
end

-- Same uncapped totals ReaderStatistics:insertDB caches in the book table.
function DBStore:updateTotals(id_book)
    local pages, time = self.conn:rowexec(string.format([[
        SELECT count(DISTINCT page), sum(duration)
        FROM   page_stat
        WHERE  id_book = %d;
    ]], id_book))
    local stmt = self.conn:prepare("UPDATE book SET total_read_time = ?, total_read_pages = ? WHERE id = ?;")
    stmt:reset():bind(tonumber(time) or 0, tonumber(pages) or 0, id_book):step()
    stmt:close()
end

function DBStore:findOrCreateBook(title, authors, md5, last_open)
    local stmt = self.conn:prepare("SELECT id FROM book WHERE md5 = ?;")
    local row = stmt:reset():bind(md5):step()
    stmt:close()
    if row and row[1] then return tonumber(row[1]) end
    -- Column order as in ReaderStatistics:createDB:
    -- id, title, authors, notes, last_open, highlights, pages, series, language, md5, total_read_time, total_read_pages
    stmt = self.conn:prepare("INSERT INTO book VALUES(NULL, ?, ?, 0, ?, 0, ?, 'N/A', 'N/A', ?, 0, 0);")
    stmt:reset():bind(title, authors, last_open, History.TOTAL_PAGES, md5):step()
    stmt:close()
    return tonumber(self.conn:rowexec("SELECT last_insert_rowid();"))
end

--- Removes everything the plugin added. tracked = { [id_book] = { start_time, ... } }.
function DBStore:undo(tracked)
    self.conn:exec("BEGIN;")
    self.conn:exec([[
        DELETE FROM page_stat_data
        WHERE  id_book IN (SELECT id FROM book WHERE md5 LIKE 'moonplus:%');
        DELETE FROM book WHERE md5 LIKE 'moonplus:%';
    ]])
    local stmt = self.conn:prepare([[
        DELETE FROM page_stat_data
        WHERE  id_book = ? AND start_time = ? AND total_pages = ?;
    ]])
    local touched = {}
    for id_book, starts in pairs(tracked or {}) do
        id_book = tonumber(id_book)
        for _, start in ipairs(starts) do
            stmt:reset():bind(id_book, start, History.TOTAL_PAGES):step()
        end
        touched[id_book] = true
    end
    stmt:close()
    self.conn:exec("COMMIT;")
    for id_book in pairs(touched) do
        self:updateTotals(id_book)
    end
end

History.DBStore = DBStore

return History
