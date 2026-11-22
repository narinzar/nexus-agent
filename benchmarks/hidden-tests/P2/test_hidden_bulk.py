from inventory.pricing import apply_bulk_discount


def test_tiers():
    assert apply_bulk_discount(10000, 9) == 10000
    assert apply_bulk_discount(10000, 10) == 9000
    assert apply_bulk_discount(10000, 49) == 9000
    assert apply_bulk_discount(10000, 50) == 8500
    assert apply_bulk_discount(10000, 500) == 8500
