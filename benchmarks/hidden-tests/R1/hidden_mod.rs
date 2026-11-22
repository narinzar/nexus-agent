use calc::{eval, CalcError};

#[test]
fn modulo() {
    assert_eq!(eval("7 % 3"), Ok(1));
    assert_eq!(eval("2 + 7 % 4 * 2"), Ok(8));
    assert_eq!(eval("5 % 0"), Err(CalcError::DivisionByZero));
}
