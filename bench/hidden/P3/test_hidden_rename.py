import inventory.pricing as pricing
from inventory import Item, Store
from inventory.report import render_report


def test_renamed():
    assert pricing.format_money(1234) == "$12.34"
    assert not hasattr(pricing, "format_price")
    s = Store()
    s.add_item(Item("A1", "Widget", 250, 1))
    assert "$2.50" in render_report(s)[2]
