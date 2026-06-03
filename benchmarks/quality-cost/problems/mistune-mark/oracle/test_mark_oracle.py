# Hidden feature oracle for the ==mark== feature (the agent never sees this).
import mistune


def test_mark_basic():
    assert "<mark>hi</mark>" in mistune.html("==hi==")


def test_mark_midtext():
    assert "<mark>b</mark>" in mistune.html("a ==b== c")


def test_single_equals_not_mark():
    assert "<mark>" not in mistune.html("a = b")


def test_mark_nested_inline():
    out = mistune.html("==**b**==")
    assert "<mark>" in out and "<strong>b</strong>" in out
