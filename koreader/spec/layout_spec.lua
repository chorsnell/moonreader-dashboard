local Layout = require("layout")

-- A fake CreDocument: pages are spans of one long text, each in a spine item.
local function fakeDoc(spec)
    local doc = { info = { has_pages = false } }
    function doc:getPageCount() return #spec end
    function doc:getPageXPointer(page) return spec[page].xp end
    -- the text between two page starts: what the earlier one says comes after it
    function doc:getTextFromXPointers(from, to)
        for i, p in ipairs(spec) do
            if p.xp == from and spec[i + 1] and spec[i + 1].xp == to then return p.text end
        end
        for _, p in ipairs(spec) do
            if p.xp == to then return p.lead end
        end
    end
    return doc
end

describe("Layout", function()
    it("counts characters, not bytes", function()
        assert_eq(Layout.length("héllo"), 5)
        assert_eq(Layout.length(nil), 0)
    end)

    it("finds the spine item of an xpointer", function()
        assert_eq(Layout.fragment("/body/DocFragment[12]/body/p[3]/text().4"), 12)
        assert_nil(Layout.fragment("/body/p"))
        assert_nil(Layout.fragment(nil))
    end)

    it("measures each page from the start of its spine item", function()
        local doc = fakeDoc({
            { xp = "/body/DocFragment[1]/body/h1/text().0", lead = "", text = "Chapter one. " },
            { xp = "/body/DocFragment[2]/body/p[1]/text().0", lead = "", text = "ab" },
            { xp = "/body/DocFragment[2]/body/p[4]/text().2", text = "cdé" },
            { xp = "/body/DocFragment[2]/body/p[9]/text().0", text = "" },
        })
        assert_same(Layout.build(doc), {
            { xp = "/body/DocFragment[1]/body/h1/text().0", offset = 0, pct = 0.25 },
            { xp = "/body/DocFragment[2]/body/p[1]/text().0", offset = 0, pct = 0.5 },
            { xp = "/body/DocFragment[2]/body/p[4]/text().2", offset = 2, pct = 0.75 },
            { xp = "/body/DocFragment[2]/body/p[9]/text().0", offset = 5, pct = 1 },
        })
    end)

    it("counts a page that starts inside a spine item from that item's start", function()
        local doc = fakeDoc({
            { xp = "/body/DocFragment[1]/body/p[1]/text().0", lead = "", text = "x" },
            { xp = "/body/DocFragment[2]/body/p[2]/text().0", lead = "twelve chars" },
        })
        assert_eq(Layout.build(doc)[2].offset, 12)
    end)

    it("skips paged documents, long books and broken ones", function()
        assert_nil(Layout.build({ info = { has_pages = true } }))
        local long = fakeDoc({ { xp = "/body/DocFragment[1]" }, { xp = "/body/DocFragment[1]/p" } })
        assert_nil(Layout.build(long, 1))
        local broken = { info = {}, getPageCount = function() error("no") end }
        assert_nil(Layout.build(broken))
        assert_nil(Layout.signature(broken))
        assert_eq(Layout.signature(long), "2")
    end)
end)
