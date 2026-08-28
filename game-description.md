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

If the face-down draw pile is empty, players cannot draw from it and must draw from any other legal source.

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

- You have a visible 8 in row 1, column 4.
- Directly beneath it is a face-down card.
- You are holding another 8.
- You wave the 8 into row 2, column 4.
- The card that was in row 2, column 4 becomes your new held card.
- That removed card is a 1, and you already have a visible 1 in row 2, column 5.
- You may wave again.

Board after the first wave:

```text
Row 1: [ 8 ]  [ 3 ] [ ? ] [ ? ] [ ? ]
Row 2: [ 12 ] [ 3 ] [ 7 ] [ 8 ] [ 1 ]
```

If you wave the 1 into row 1, column 5, the card that was there is removed and becomes your new held card.
If that removed card is a 3 and you already have a visible 3 in row 1, column 2, you may wave again.

The important rule is the same every time: each wave moves the held card into the opposite row of the matching column, removes the card that was in that spot, and turns that removed card into the new held card.

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

## 15. Source of Truth

This document is the canonical how-to-play reference for Skip-Bo Golf. If any later document disagrees with this one, this file should be treated as the game rules to follow.