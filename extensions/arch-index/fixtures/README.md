# CMT integration fixture

`arch-index-cmt-1.15.db.xz` is a redacted copy of an existing CMT producer
database for the public
[`epure-team/arch-index`](https://github.com/epure-team/arch-index) source.
Its `producer_runs` row says `arch_index_cmt/sound_with_top`; the producer
invocation was not replayed for this test. The source checkout's HEAD at
fixture extraction was `c9c80a4986c04855b5859bfbd34d775aea01c5cf`;
the original indexing worktree's cleanliness was not independently verified.
The original database's SHA-256 was
`f6739f5f2a2ba558a9552b46efea37c2c7163c03b4e6af56570b7225cf54ff67`.

The fixture retains the producer's actual `comment_db_meta`, `producer_runs`,
`modules`, `functions`, `calls`, and `analysis_coverage` tables, with 4,060
functions and 23,329 calls. Other tables were dropped before `VACUUM` because
they contained absolute build paths and were not used by this adapter. No
columns or call rows were fabricated. A string scan of the resulting database
found no `/home/`, `/tmp/`, or PEM private-key markers.

The Node pack test runs `test_adapter.py` against this fixture on every test
run. It verifies versioned schema adaptation, failure on damaged producer
provenance, and the `init.sh` install/validation seam using a stub that supplies
this real producer output. The OCaml producer invocation is not replayed by CI.
The empty `analysis_coverage` table does not assert source completeness. These
tests do not prove complete source coverage or negative reachability.
