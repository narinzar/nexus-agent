import pytest
from inventory import Item, Store


def make():
    s = Store()
    s.add_item(Item("A1", "Widget", 250, 12))
    s.add_item(Item("B2", "Gadget", 1999, 3))
    return s


def test_total_value():
    assert make().total_value() == 250 * 12 + 1999 * 3


def test_low_stock():
    assert [i.sku for i in make().low_stock()] == ["B2"]


def test_remove_too_many():
    with pytest.raises(ValueError):
        make().remove("B2", 4)
