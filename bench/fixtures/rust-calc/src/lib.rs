//! A tiny arithmetic expression evaluator: integers, + - * /, parentheses.
mod lexer;
mod parser;

pub use lexer::{tokenize, Token};
pub use parser::Parser;

#[derive(Debug, PartialEq)]
pub enum CalcError {
    UnexpectedChar(char),
    UnexpectedToken(String),
    DivisionByZero,
    UnexpectedEnd,
}

/// Evaluate an expression like "2 * (3 + 4)".
pub fn eval(input: &str) -> Result<i64, CalcError> {
    let tokens = tokenize(input)?;
    let mut p = Parser::new(tokens);
    let v = p.expr()?;
    p.finish()?;
    Ok(v)
}
