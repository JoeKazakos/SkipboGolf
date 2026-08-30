 # Skip-Bo Golf Rules

This file describes how to play Skip-Bo Golf. It is the rules reference for the game.

## 1. Players and Goal

Skip-Bo Golf is played by six players.

The goal is to finish the round with the lowest score.

## 2. Basic Structure

The game is played in rounds.

At the start of each round:

- shuffle the deck
- deal every player 10 cards
- arrange each player's cards in a play area with 5 columns and 2 rows
- begin with one face-up card in the middle of the table from the draw pile

The deck contains 162 cards total:

- 12 copies of each rank from 1 through 12
- 18 Skip-Bo cards, treated as rank 13

Ranks are represented as the values 1 through 13. The rank 13 card is the Skip-Bo card.

## 3. Player Play Area

Each player has a personal play area of 10 cards arranged as 5 columns by 2 rows.

Each position in that 5 x 2 grid contains exactly one card. The play area is not a stack.
At all times, each player has exactly 10 cards in the play area.

At the start of the round, the bottom-left, bottom-middle, and bottom-right cards are face up and visible. All of the other cards are face down and hidden.

Face-up cards may be seen by all players. Face-down cards remain hidden until they are revealed during play.

## 4. Draw Sources

On your turn, you choose one card source:

- the face-up card in the middle of the table
- the face-down draw pile
- the top card of any other player's discard pile

The middle card comes from the draw pile and is available only as the starting face-up card for the round.
It is not replaced after it is taken.
After it is taken, there is no face-up center card available for the rest of that round.

You cannot draw from your own discard pile.
You can draw from any other player's discard pile, but only the top card of that pile is available.
For each discard pile, only the top three cards are visible to all players.
Cards below the top card in a discard pile are not available unless the cards above them are removed first.

If the face-down draw pile is empty, it is rebuilt by reshuffling the discard piles. See section 15.8.

Example:

- If the player to your right has a discard pile with 9 on top, you may take that 9 on your turn.
- If you take the top card from another player's discard pile, the next card in that pile becomes the new top card for future turns.
- You may see up to the top three cards of another player's discard pile, but you may still draw only the top one.
- If your own discard pile has a usable card on top, you still may not draw from it.

## 5. Turn Order

The starting player takes the first turn.

Play then continues to the left.

On the first turn of a round, no player discard piles have cards yet.
After turns have been taken, players may draw from the top card of any other player's discard pile.

## 6. What You Do On Your Turn

On your turn, you take one card from your chosen draw source.

After taking that card, you place it into your own play area by replacing one card in your grid.

You may replace either:

- a face-up card
- a face-down card

The card that was replaced is now the card you are holding.

After the replacement, you either discard that card or use it for a wave if it matches an existing card in your play area.

See section 15.2: placing the drawn card is optional, and section 15.11 for the precise turn structure.

Example:

- You draw a 6.
- You replace a face-down card in column 3.
- The replaced card is a 4.
- If you already have a visible 4 in your play area, you may wave the 4 into the matching spot instead of discarding it.

## 7. Face-Up and Face-Down Cards

A face-up card is visible to everyone.

A face-down card is hidden.

Replacing a face-down card reveals it.

## 8. Matching

A card matches another card when it has the same rank or value as an existing visible card in your play area.

Only visible cards can be matched for a wave.

## 9. Wave

A wave is a chain move that happens when the card you are holding matches one of the visible cards in your play area.

When you wave:

- place the held card into the matching spot in the same column, in the opposite row from the matched visible card
- that matching spot may be face up or face down
- remove the card that was in that matching spot
- make the removed card your new held card

The card in the other row of that column must be the card you are matching against.
That is the visible card that lets you wave.

If the new held card matches another visible card, you may wave again.

If the card you are holding matches a visible card but you do not want to continue, you may stop waving, discard the held card, and end your turn.

If the card you are holding does not match any existing visible card, you cannot wave.

Wave example:

Start:

- You have a visible 3 in row 1, column 2.
- There is a face-down card directly beneath it in row 2, column 2.
- You are holding a 3.

Board before the wave:

```text
Row 1: [ 8 ]  [ 3 ] [ ? ] [ ? ] [ ? ]
Row 2: [ 12 ] [ ? ] [ 7 ] [ 8 ] [ 1 ]
```

Step 1:

```text
Row 1: [ 8 ]  [ 3 ] [ ? ] [ ? ] [ ? ]
Row 2: [ 12 ] [ 3 ] [ 7 ] [ 8 ] [ 1 ]
```

You place the held 3 into row 2, column 2.
The card that was in row 2, column 2 is removed and becomes your new held card.
Suppose that removed card is a 7.
The 7 is now your new held card.

Because the 7 is now the card you are holding, you check whether it matches another visible card in your play area.
If you want to stop here, you may discard the 7 and end your turn.

Step 2:

If you do want to continue, and you already have a visible 7 in another column, you may wave again.
The same rule applies each time:

- place the held card into the matching spot opposite the visible match
- remove the card in that spot
- make the removed card your new held card
- continue if the new held card matches another visible card
- stop and discard if you want to end the wave

Longer wave example:

This example is fully worked through, step by step, and is used as a test fixture
by the implementation. `?` marks a face-down card.

Board at the start of your turn:

```text
Row 1: [ ? ]  [ 3 ] [ ? ] [ 8 ] [ ? ]
Row 2: [ 12 ] [ ? ] [ 7 ] [ ? ] [ 1 ]
```

Visible: the 3 at row 1 column 2, the 8 at row 1 column 4, the 12 at row 2 column 1,
the 7 at row 2 column 3, and the 1 at row 2 column 5.

You draw an 8 from the center.

Step 1. You place the 8 into row 2, column 4, directly opposite the visible 8.
The face-down card there is revealed to be a 1 and becomes your held card.
Row 2, column 4 is now locked for the rest of this turn.

```text
Row 1: [ ? ]  [ 3 ] [ ? ] [ 8 ] [ 1 ]   <- held: 1
Row 2: [ 12 ] [ ? ] [ 7 ] [ 8 ] [ 1 ]
```

Step 2. You hold a 1 and there is a visible 1 at row 2, column 5.
You wave the 1 into row 1, column 5. That card is revealed to be a 3 and becomes your held card.
Row 1, column 5 is now locked.

Step 3. You hold a 3 and there is a visible 3 at row 1, column 2.
You wave the 3 into row 2, column 2. That card is revealed to be a 12 and becomes your held card.
Row 2, column 2 is now locked.

Step 4. You hold a 12 and there is a visible 12 at row 2, column 1.
You wave the 12 into row 1, column 1. That card is revealed to be a 7 and becomes your held card.
Row 1, column 1 is now locked.

Step 5. You hold a 7 and there is a visible 7 at row 2, column 3.
You wave the 7 into row 1, column 3. That card is revealed to be a 5 and becomes your held card.
Row 1, column 3 is now locked.

Board after step 5:

```text
Row 1: [ 12 ] [ 3 ] [ 7 ] [ 8 ] [ 1 ]   <- held: 5
Row 2: [ 12 ] [ 3 ] [ 7 ] [ 8 ] [ 1 ]
```

Step 6. You hold a 5. There is no visible 5 anywhere in your play area, so you cannot wave.
You discard the 5 and your turn ends.

All 10 of your cards are now face up, so this turn triggers the end of the round.
Every other player takes one final turn, and then the round is scored.

This play area scores 0: every column is a matching pair, and no 2 x 2 square is formed.

The important rule is the same every time: each wave moves the held card into the opposite
row of the matching column, removes the card that was in that spot, and turns that removed
card into the new held card. A spot that has already been played into this turn cannot be
played into again.

## 10. Discarding

If you cannot wave, you must discard the card you are holding.

That ends your turn.

Discarded cards go into the active discard pile for that player.

## 11. Round End

The round ends when a single player has all 10 cards in their play area face up.

When that happens, every player other than the player who triggered the end of the round gets one final turn.

After the final turn cycle is complete, the round is scored.

## 12. Scoring

The round score is used to determine each player's result for that round.

Score the 10-card play area as two rows of five cards.

There are no other scoring modifiers, multipliers, bonuses, or special tie rules.

For each column:

- if the two cards in the column have the same rank and that rank is not 7, 11, or 13, the column scores 0
- otherwise, add the value of each card in the column, except that 7, 11, and 13 each count as 0

After the column scores are added, check for 2 x 2 squares of identical ranks.

A 2 x 2 square is formed when these four positions all contain the same rank:

- row 1, column n
- row 1, column n + 1
- row 2, column n
- row 2, column n + 1

Each valid square subtracts 10 from the score.

Square bonuses are counted from left to right, and a column can only be used in one counted square.

If the hand is incomplete or contains a card without a rank, the score is 9999.

If players end up tied at the end of the round, there is no special tie-break procedure.

Lower scores are better.

Worked example 1, full hand score:

```text
Row 1: [ 5 ] [ 5 ] [ 7 ] [ 8 ] [ 8 ]
Row 2: [ 5 ] [ 5 ] [ 4 ] [ 8 ] [ 8 ]
```

Column scoring:

- Column 1: 5 and 5 match on a non-special rank, so column score is 0.
- Column 2: 5 and 5 match on a non-special rank, so column score is 0.
- Column 3: 7 and 4 do not cancel; 7 counts as 0 and 4 counts as 4, so column score is 4.
- Column 4: 8 and 8 match on a non-special rank, so column score is 0.
- Column 5: 8 and 8 match on a non-special rank, so column score is 0.

Base score = 0 + 0 + 4 + 0 + 0 = 4.

Square bonuses:

- Columns 1 and 2 form a 2 x 2 square of 5s, so subtract 10.
- Columns 4 and 5 form a 2 x 2 square of 8s, so subtract 10.

Final score = 4 - 10 - 10 = -16.

Worked example 2, overlapping square case:

```text
Row 1: [ 9 ] [ 9 ] [ 9 ] [ 2 ] [ 2 ]
Row 2: [ 9 ] [ 9 ] [ 9 ] [ 2 ] [ 2 ]
```

Base score:

- Every column is a matching non-special pair, so all five columns score 0.
- Base score = 0.

Possible 2 x 2 squares:

- Columns 1 and 2 (all 9s) is a valid square.
- Columns 2 and 3 (all 9s) is also a valid shape, but it overlaps column 2.
- Columns 4 and 5 (all 2s) is a valid square.

Because squares are counted left to right with no reused columns:

- Count columns 1 and 2: subtract 10.
- Do not count columns 2 and 3: column 2 is already used.
- Count columns 4 and 5: subtract 10.

Final score = 0 - 10 - 10 = -20.

Worked example 3, invalid hand:

- If any card in the 10-card hand is missing or has no rank, the score is 9999.
- This overrides all normal column and square scoring.

## 13. One-Round Game

A full game is one round.

After scoring that round, the player with the lowest score wins the game.

## 14. Quick Summary

- Six players play.
- Deal 10 cards to each player in a 5-column, 2-row play area.
- The bottom-left, bottom-middle, and bottom-right cards start face up.
- The other cards start face down.
- The center face-up card is only the starting center card for the round and is not replaced after it is taken.
- On your turn, draw from the center card (if still available), the face-down draw pile, or the top card of another player's discard pile.
- You may draw from any other player's discard pile, but never your own.
- For each discard pile, only the top three cards are visible, and only the top card can be drawn.
- Replace one card in your play area.
- If the held card matches a visible card, you may wave.
- If you cannot wave, discard the card and end your turn.
- When one player has all 10 cards face up, every other player gets one final turn.
- Score the round.
- The game is one round total.
- Lowest score in that round wins.

## 15. Clarifications and Rulings

The following points were ambiguous, unstated, or self-contradictory in earlier versions
of this document. They were resolved deliberately and are binding on the implementation.
Items marked **[RULES CHANGE]** alter the game as originally written; all others only make
explicit what was already implied.

### 15.1 A spot may be played into only once per turn

The spot you place your drawn card into is locked for the remainder of that turn, and so is
every spot you subsequently wave into. You may not play into a locked spot again, even if a
later wave would legally match it.

This makes a turn at most 10 placements long and makes an endless wave chain impossible.

### 15.2 Placing the drawn card is optional **[RULES CHANGE]**

Section 6 as originally written required you to place the drawn card into your grid. You may
instead discard the drawn card immediately, ending your turn without changing your play area.

### 15.3 Waving is always optional

Whenever you are holding a card you may choose to discard it and end your turn, even when a
legal wave is available. You are never forced to wave.

### 15.4 Every card placed into the grid is face up

Any card entering the play area, whether by the initial replacement or by a wave, is placed
face up and remains face up. Only cards from the original deal are ever face down. This is
what makes the round-end condition in section 11 reachable.

### 15.5 The round-end check happens at the end of a completed turn

A wave chain may turn your tenth card face up while you are still holding a card. The turn
still completes normally: you stop waving and discard the held card. The "all 10 face up"
check is then applied. Every turn therefore ends with exactly one discard.

### 15.6 All hands are revealed for scoring

At round end every player's play area is turned face up and scored by section 12 exactly as
it lies. Face-down cards carry no penalty. The score of 9999 applies only to a genuinely
malformed hand, that is one with fewer than 10 cards or a card with no rank. It never applies
to a hand that merely still contains face-down cards.

### 15.7 Going face up during the final turn cycle has no special effect

If a player other than the one who triggered the round end also reaches 10 face-up cards
during the final turn cycle, nothing changes. The cycle completes and everyone scores.

### 15.8 Exhausting the draw pile triggers a reshuffle **[RULES CHANGE]**

If the face-down draw pile is empty, gather every discard pile except the top card of each,
shuffle them, and place the result face down as the new draw pile. Each player keeps the top
card of their own discard pile. This guarantees that a legal draw source always exists.

### 15.9 Each player has exactly one discard pile

Section 10's phrase "the active discard pile" is loose wording. Six players have six discard
piles, one each.

### 15.10 The center card remains available until taken

The face-up center card is a legal draw source for any player on any turn until somebody
takes it. Once taken it is never replaced and there is no center card for the rest of the
round.

### 15.11 Turn structure, stated precisely

A turn is a sequence of placements ending in exactly one discard:

1. Take one card from a legal source. It becomes your held card.
2. Optionally place the held card into any unlocked spot in your play area. The first
   placement of the turn may target any spot. Every later placement must be a legal wave:
   the held card's rank must match a visible card, and it must go into the opposite row of
   that card's column. The displaced card becomes your new held card and the spot locks.
3. Repeat step 2 as long as you wish and legal waves remain.
4. Discard the held card. Your turn ends.

### 15.12 The table may seat two to seven players **[RULES CHANGE]**

Section 1 specifies six players, and six remains the default. The implementation also
supports a table of one human plus one to six computer opponents, chosen before the round
is dealt.

Nothing else in the rules changes. Seating order, the draw sources, the wave rule, the
end-of-round trigger, the final turn cycle and the scoring are all written in terms of
"the players at the table" rather than a fixed six, and hold at any of these sizes. The
162-card deck is ample: seven players use 70 cards for the grids, leaving 91 in the draw
pile.

Two consequences worth stating:

- With two players there is exactly one other discard pile to draw from, so the draw
  choice narrows considerably.
- The opponent ratings in the app were measured in six-player games. They order the
  opponents correctly but are not calibrated for other table sizes.

### 15.13 A match may run several rounds **[RULES CHANGE]**

Section 13 says a full game is one round, and one round remains the default and the
faithful reading. The app also offers a match of 3, 9 or 18 rounds, chosen before play.

A match changes nothing about how a round is played or scored. It deals a fresh round each
time and adds each player's round score to a running total; the lowest total after the last
round wins. Ties are untied, as in section 12.

This is bookkeeping around the rules rather than part of them, so it lives outside the
engine (`src/ui/match.ts`). The engine remains a single-round implementation.

### 15.14 A card drawn from the pile is turned face up as it is taken **[RULES CHANGE]**

Section 4 does not say whether the rest of the table sees a card drawn from the face-down
draw pile. This implementation turns it face up as it is taken, so every draw - center
card, discard top or draw pile - is public information the moment it happens.

The pile itself stays face down and unknown. Nobody learns what the NEXT card will be;
only the card actually drawn becomes known.

Two consequences worth stating:

- Every player, human and computer alike, sees what an opponent picked up and can follow
  what they do with it. The information is symmetric: the computer players learn the
  human's draws on exactly the same terms.
- One case remains private. A card lifted out of a FACE-DOWN spot during a wave is
  revealed only to the player who lifted it, because nobody else ever saw that card. That
  card shows as face down in the player's hand.

### 15.15 A placement that changes nothing is not offered **[RULES CHANGE]**

Placing the held card into a spot that already shows that same rank face up leaves the
play area exactly as it was, and hands back a card of the rank just played. Nothing about
the position changes; the only effect is that the spot is locked for the rest of the turn,
which loses an option.

Such a placement is therefore not a legal move, for the first placement of a turn or for
any wave after it. This removes nothing a player could want: any line of play that used
one is strictly worse than the same line without it.

It also matters in practice. Before this rule, the search picked one of these do-nothing
waves in roughly thirty per cent of the positions where it was available, which is how it
came to recommend moves that plainly accomplished nothing.

## 16. Source of Truth

This document is the canonical how-to-play reference for Skip-Bo Golf. If any later document disagrees with this one, this file should be treated as the game rules to follow.

The app carries a short player-facing summary of these rules in
`src/ui/RulesPanel.tsx`, reached from "How to play". It covers the turn, the wave, scoring
and the round end, and is deliberately much shorter than this document. If a rule here
changes, check that panel too.