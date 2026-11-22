use crate::lexer::Token;
use crate::CalcError;

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Parser { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    pub fn finish(&self) -> Result<(), CalcError> {
        match self.peek() {
            None => Ok(()),
            Some(t) => Err(CalcError::UnexpectedToken(format!("{:?}", t))),
        }
    }

    /// expr := term (('+' | '-') term)*
    pub fn expr(&mut self) -> Result<i64, CalcError> {
        let mut v = self.term()?;
        while let Some(t) = self.peek() {
            match t {
                Token::Plus => { self.next(); v += self.term()?; }
                Token::Minus => { self.next(); v -= self.term()?; }
                _ => break,
            }
        }
        Ok(v)
    }

    /// term := factor (('*' | '/') factor)*
    fn term(&mut self) -> Result<i64, CalcError> {
        let mut v = self.factor()?;
        while let Some(t) = self.peek() {
            match t {
                Token::Star => { self.next(); v *= self.factor()?; }
                Token::Slash => {
                    self.next();
                    let d = self.factor()?;
                    if d == 0 { return Err(CalcError::DivisionByZero); }
                    v /= d;
                }
                _ => break,
            }
        }
        Ok(v)
    }

    /// factor := number | '(' expr ')' | '-' factor
    fn factor(&mut self) -> Result<i64, CalcError> {
        match self.next() {
            Some(Token::Num(n)) => Ok(n),
            Some(Token::Minus) => Ok(-self.factor()?),
            Some(Token::LParen) => {
                let v = self.expr()?;
                match self.next() {
                    Some(Token::RParen) => Ok(v),
                    Some(t) => Err(CalcError::UnexpectedToken(format!("{:?}", t))),
                    None => Err(CalcError::UnexpectedEnd),
                }
            }
            Some(t) => Err(CalcError::UnexpectedToken(format!("{:?}", t))),
            None => Err(CalcError::UnexpectedEnd),
        }
    }
}
