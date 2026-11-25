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
    it("counts characters as Moon+ shows them", function()
        assert_eq(Layout.measure("héllo"), 5)
        assert_eq(Layout.measure("so\194\173ft"), 4) -- soft hyphen
        assert_eq(Layout.measure("\240\159\152\128"), 2) -- two UTF-16 units
        assert_eq(Layout.measure("  one \t  two"), 7)
        assert_eq(Layout.measure("ab\n\ncd\nef"), 9) -- two breaks of 1.5
        assert_eq(Layout.measure(nil), 0)
        assert_eq(Layout.measure(" \n "), 0)
    end)

    it("counts the space or break a piece ends with, so pieces add up", function()
        assert_eq(Layout.measure("one "), 4)
        assert_eq(Layout.measure("one\n"), 4.5)
        assert_eq(Layout.measure("one ") + Layout.measure("two"), Layout.measure("one two"))
    end)

    it("finds the spine item of an xpointer", function()
        assert_eq(Layout.fragment("/body/DocFragment[12]/body/p[3]/text().4"), 12)
        assert_eq(Layout.fragment("/body/DocFragment/body/p[3]/text().4"), 1)
        assert_eq(Layout.fragment("/body/DocFragment"), 1)
        assert_nil(Layout.fragment("/body/DocFragmentX"))
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
    end)

    it("changes its signature with the font and margins, not only the page count", function()
        local doc = fakeDoc({ { xp = "/body/DocFragment[1]" } })
        doc.configurable = { font_size = 22, h_page_margins = { 10, 10 } }
        local first = Layout.signature(doc, "Noto Serif")
        assert_eq(Layout.signature(doc, "Noto Serif"), first)
        assert_true(Layout.signature(doc, "Bitter") ~= first)
        doc.configurable.h_page_margins = { 20, 20 }
        assert_true(Layout.signature(doc, "Noto Serif") ~= first)
        doc.configurable.h_page_margins = { 10, 10 }
        doc.getDocumentRenderingHash = function() return 7 end
        assert_true(Layout.signature(doc, "Noto Serif") ~= first)
    end)

    it("measures each spine item that has another after it, and clears the selection", function()
        local cleared = 0
        local doc = { info = {} }
        local xps = { "/body/DocFragment[1]/body/p[1]", "/body/DocFragment[3]/body/p[1]" }
        function doc:getPageCount() return 2 end
        function doc:getPageXPointer(page) return xps[page] end
        function doc:getTextFromXPointers(from, to)
            if from == xps[1] and to == "/body/DocFragment[3]" then return "abcde" end
            return ""
        end
        function doc:clearSelection() cleared = cleared + 1 end
        local pages, lengths = Layout.build(doc)
        assert_eq(#pages, 2)
        assert_same(lengths, { 5, 0 })
        assert_eq(cleared, 1)
    end)

    it("says where the contents point", function()
        local doc = {}
        function doc:getToc()
            return {
                { xpointer = "/body/DocFragment[2]/body/h1" },
                { xpointer = "/body/DocFragment[2]/body/h2" },
                { xpointer = "nowhere" },
            }
        end
        function doc:getTextFromXPointers(from, to)
            assert_eq(from, "/body/DocFragment[2]")
            if to == "/body/DocFragment[2]/body/h2" then return "twelve chars" end
        end
        assert_same(Layout.toc(doc), { { fragment = 2, offset = 0 }, { fragment = 2, offset = 12 } })
        assert_nil(Layout.toc({}))
        assert_nil(Layout.toc({ getToc = function() return {} end }))
    end)
end)
