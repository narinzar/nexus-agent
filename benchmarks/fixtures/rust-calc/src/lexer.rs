use crate::CalcError;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Num(i64),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

pub fn tokenize(s: &str) -> Result<Vec<Token>, CalcError> {
    let mut out = Vec::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' => {}
            '0'..='9' => {
                let mut n = 0i64;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    n = n * 10 + chars[i].to_digit(10).unwrap() as i64;
                    i += 1;
                }
                out.push(Token::Num(n));
                continue;
            }
            '+' => out.push(Token::Plus),
            '-' => out.push(Token::Minus),
            '*' => out.push(Token::Star),
            '/' => out.push(Token::Slash),
            '(' => out.push(Token::LParen),
            ')' => out.push(Token::RParen),
            other => return Err(CalcError::UnexpectedChar(other)),
        }
        i += 1;
    }
    Ok(out)
}
