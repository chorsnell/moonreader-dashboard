local Highlights = require("highlights")

-- A fake reflowable document: the "book" is a string, XPointers are byte offsets.
local function fakeDoc(text)
    local lower = text:lower()
    local doc = { searches = {} }
    doc.findAllText = function(pattern)
        table.insert(doc.searches, pattern)
        local hits, init = {}, 1
        local p = pattern:lower()
        while true do
            local s, e = lower:find(p, init, true)
            if not s then break end
            table.insert(hits, { start = s, ["end"] = e })
            init = s + 1
        end
        return hits
    end
    doc.getText = function(a, b) return text:sub(a, b) end
    doc.compare = function(a, b)
        if b > a then return 1 elseif b == a then return 0 end
        return -1
    end
    return doc
end

describe("highlights", function()
    it("normalises quotes, apostrophes, dashes, whitespace and case", function()
        assert_eq(Highlights.normalize("  \u{201C}Don\u{2019}t\u{201D} \n\t panic \u{2014} OK\u{00A0}now "),
            "\"don't\" panic - ok now")
        assert_eq(Highlights.normalize("soft\u{00AD}hyphen"), "softhyphen")
        assert_eq(Highlights.normalize(nil), "")
    end)

    it("hashes normalised text", function()
        assert_eq(Highlights.hash("Don\u{2019}t  Panic"), Highlights.hash("don't panic"))
        assert_true(Highlights.hash("a") ~= Highlights.hash("b"))
    end)

    it("splits long passages into 8-word prefix and suffix", function()
        local p, s = Highlights.patterns("one two three")
        assert_eq(p, "one two three")
        assert_nil(s)
        local long = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15 w16 w17 w18"
        p, s = Highlights.patterns(long)
        assert_eq(p, "w1 w2 w3 w4 w5 w6 w7 w8")
        assert_eq(s, "w11 w12 w13 w14 w15 w16 w17 w18")
    end)

    it("finds a short passage", function()
        local doc = fakeDoc("It was a bright cold day in April, and the clocks were striking thirteen.")
        local a, b = Highlights.findSpan(doc, "the clocks were striking thirteen")
        assert_eq(doc.getText(a, b), "the clocks were striking thirteen")
    end)

    it("reports ambiguous and missing short passages", function()
        local doc = fakeDoc("yes. no. yes.")
        local a, why = Highlights.findSpan(doc, "yes")
        assert_nil(a)
        assert_eq(why, "ambiguous")
        a, why = Highlights.findSpan(doc, "maybe")
        assert_nil(a)
        assert_eq(why, "not_found")
    end)

    it("joins prefix and suffix hits for long passages, picking the matching span", function()
        local passage = "One two three four five six seven eight middle words here then " ..
            "alpha beta gamma delta epsilon zeta eta theta"
        -- The suffix also appears before the prefix and again much later.
        local book = "alpha beta gamma delta epsilon zeta eta theta. Intro. " ..
            "One two three four five six seven eight middle words here then\n" ..
            "alpha beta gamma delta epsilon zeta eta theta. More text. " ..
            "alpha beta gamma delta epsilon zeta eta theta."
        local doc = fakeDoc(book)
        local a, b = Highlights.findSpan(doc, passage)
        assert_true(a ~= nil, "found")
        assert_eq(Highlights.normalize(doc.getText(a, b)), Highlights.normalize(passage))
        assert_eq(#doc.searches, 2, "one prefix and one suffix search")
    end)

    it("tolerates typographic differences between Moon+ text and the book", function()
        local book = "He said \u{201C}it\u{2019}s fine\u{201D} \u{2014} and left the room without another word, " ..
            "closing the door behind him very quietly indeed."
        local doc = fakeDoc(book)
        -- The fake search is literal, so search for what's in the book; matching is on normalised text.
        local a, b = Highlights.findSpan(doc, "closing the door behind him very quietly indeed.")
        assert_eq(doc.getText(a, b), "closing the door behind him very quietly indeed.")
        assert_eq(Highlights.normalize(book:sub(1, 34)), Highlights.normalize("He said \"it's fine\" - and"))
    end)

    it("rejects a long passage whose middle differs", function()
        local passage = "One two three four five six seven eight DIFFERENT words here then " ..
            "alpha beta gamma delta epsilon zeta eta theta"
        local doc = fakeDoc("One two three four five six seven eight middle words here then " ..
            "alpha beta gamma delta epsilon zeta eta theta")
        local a, why = Highlights.findSpan(doc, passage)
        assert_nil(a)
        assert_eq(why, "not_found")
    end)

    it("keeps only highlights not already present or applied", function()
        local hl = {
            { text = "Already here", kind = "highlight" },
            { text = "Applied before", kind = "highlight" },
            { text = "New one", kind = "note", note = "n" },
            { text = "new   ONE", kind = "highlight" },
            { text = "", kind = "highlight" },
            { text = "a bookmark", kind = "bookmark" },
        }
        local annotations = { { text = "already  here" } }
        local applied = { [Highlights.hash("applied before")] = true }
        local pending = Highlights.pending(hl, annotations, applied)
        assert_eq(#pending, 1)
        assert_eq(pending[1].text, "New one")
    end)

    it("converts dashboard times to KOReader datetime", function()
        assert_eq(Highlights.datetime("2024-03-01T21:10:00"), "2024-03-01 21:10:00")
        assert_eq(Highlights.datetime("2024-03-01T21:10:00.000Z"), "2024-03-01 21:10:00")
        assert_eq(Highlights.datetime("2024-03-01T21:10"), "2024-03-01 21:10:00")
        assert_eq(Highlights.datetime("2024-03-01"), "2024-03-01 00:00:00")
        assert_nil(Highlights.datetime(nil))
    end)

    it("lists unplaced passages in the fallback note", function()
        local note = Highlights.fallbackNote({ { text = "A" }, { text = "B", note = "why" } })
        assert_true(note:find("• A", 1, true) ~= nil)
        assert_true(note:find("Note: why", 1, true) ~= nil)
    end)
end)
