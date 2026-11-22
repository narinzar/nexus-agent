from inventory import Item, Store
from inventory.report import render_report


def test_title():
    s = Store()
    s.add_item(Item("A1", "Widget", 250, 12))
    lines = render_report(s)
    assert lines[0] == "Stock Report"
    assert lines[1] == "=" * len("Stock Report")
