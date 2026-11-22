from inventory.pricing import apply_bulk_discount, format_price


def test_format():
    assert format_price(1234) == "$12.34"
    assert format_price(5) == "$0.05"


def test_bulk():
    assert apply_bulk_discount(10000, 10) == 9000
    assert apply_bulk_discount(10000, 9) == 10000
