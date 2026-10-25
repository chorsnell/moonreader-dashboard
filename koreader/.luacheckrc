-- Mirrors KOReader's own .luacheckrc (koreader/.luacheckrc on master)
unused_args = false
std = "luajit"
-- ignore implicit self
self = false

globals = {
    "G_reader_settings",
    "G_defaults",
    "table.pack",
    "table.unpack",
}

read_globals = {
    "_ENV",
}

-- The test runner and specs define a tiny busted-like API and stub KOReader globals.
files["**/spec/*.lua"].globals = {
    "describe",
    "it",
    "before_each",
    "assert_eq",
    "assert_true",
    "assert_false",
    "assert_nil",
    "assert_same",
    "G_reader_settings",
    "G_defaults",
}

ignore = {
    "211/__*", -- Unused local variable
    "231/__",  -- Local variable is set but never accessed
    "631",     -- Line is too long
    "dummy",
}
