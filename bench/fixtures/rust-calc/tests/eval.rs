use calc::{eval, CalcError};

#[test]
fn precedence() {
    assert_eq!(eval("2 + 3 * 4"), Ok(14));
    assert_eq!(eval("(2 + 3) * 4"), Ok(20));
}

#[test]
fn errors() {
    assert_eq!(eval("1 / 0"), Err(CalcError::DivisionByZero));
    assert_eq!(eval("2 $ 3"), Err(CalcError::UnexpectedChar('$')));
}
