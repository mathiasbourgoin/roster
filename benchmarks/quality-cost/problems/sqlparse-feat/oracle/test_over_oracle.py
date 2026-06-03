# Hidden oracle for the OVER-clause grouping feature (the agent never sees this).
# Mirrors the assertions from the real upstream commit that added the feature.
import sqlparse
from sqlparse import sql


def test_over_window_name():
    p = sqlparse.parse("foo(c1) over win1 as bar")[0]
    assert isinstance(p.tokens[0], sql.Identifier)
    assert isinstance(p.tokens[0].tokens[0], sql.Function)
    assert len(p.tokens[0].tokens[0].tokens) == 4
    assert isinstance(p.tokens[0].tokens[0].tokens[3], sql.Over)
    assert isinstance(p.tokens[0].tokens[0].tokens[3].tokens[2], sql.Identifier)


def test_over_parenthesis():
    p = sqlparse.parse("foo(c1) over (partition by c2 order by c3) as bar")[0]
    assert isinstance(p.tokens[0], sql.Identifier)
    assert isinstance(p.tokens[0].tokens[0], sql.Function)
    assert len(p.tokens[0].tokens[0].tokens) == 4
    assert isinstance(p.tokens[0].tokens[0].tokens[3], sql.Over)
    assert isinstance(p.tokens[0].tokens[0].tokens[3].tokens[2], sql.Parenthesis)
