type AllRanks = ['1','2','3','4','5','6','7','8','9','10','11','12','13'];
const ALL_RANKS: AllRanks = ['1','2','3','4','5','6','7','8','9','10','11','12','13'];


import { Component, signal, computed } from '@angular/core';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';


type SkipBoRank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13';
interface Card {
  rank: SkipBoRank;
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  // 12 of each number 1-12
  for (let n = 1; n <= 12; n++) {
    for (let i = 0; i < 12; i++) {
      deck.push({ rank: n.toString() as SkipBoRank });
    }
  }
  // 18 Skip-Bo (13) cards
  for (let i = 0; i < 18; i++) {
    deck.push({ rank: '13' });
  }
  return deck;
}

function shuffle(deck: Card[]): Card[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MatSelectModule, MatFormFieldModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('Skip-Bo Card Game');
  protected deck = signal<Card[]>([]);
  protected hand = signal<Card[]>([]);
  public editingCardIndex = signal<number|null>(null);
  public allRanks = ALL_RANKS;

  public startEditCard(idx: number) {
    this.editingCardIndex.set(idx);
  }

  public setCardRank(idx: number, rank: SkipBoRank) {
    const hand = [...this.hand()];
    if (hand[idx]) {
      hand[idx] = { rank };
      this.hand.set(hand);
    }
    this.editingCardIndex.set(null);
  }
  public handScore = computed((): number => {
    const hand = this.hand() ?? [];
    if (hand.some(card => !card || !card.rank)) {
      return 9999;
    }
    const row1 = hand.slice(0, 5);
    const row2 = hand.slice(5, 10);
    let score = 0;
    for (let col = 0; col < 5; col++) {
      const card1 = row1[col];
      const card2 = row2[col];
      if (
        card1 && card2 &&
        card1.rank === card2.rank &&
        card1.rank !== '7' && card1.rank !== '11' && card1.rank !== '13'
      ) {
        continue;
      }
      if (card1.rank !== '7' && card1.rank !== '11' && card1.rank !== '13') {
        score += Number(card1.rank);
      }
      if (card2.rank !== '7' && card2.rank !== '11' && card2.rank !== '13') {
        score += Number(card2.rank);
      }
    }

    // Check for non-overlapping 2x2 squares of the same rank (including 7, 11, 13)
    // Greedy left-to-right: mark columns as used if a square is found
    const usedCols = [false, false, false, false, false];
    for (let col = 0; col < 4; col++) {
      if (usedCols[col] || usedCols[col + 1]) continue;
      const a = row1[col];
      const b = row1[col + 1];
      const c = row2[col];
      const d = row2[col + 1];
      if (
        a && b && c && d &&
        a.rank === b.rank && a.rank === c.rank && a.rank === d.rank
      ) {
        score -= 10;
        usedCols[col] = true;
        usedCols[col + 1] = true;
      }
    }
    return score;
  });

  constructor() {
    this.resetGame();
  }

  resetGame() {
    const newDeck = shuffle(createDeck());
    this.deck.set(newDeck);
    this.hand.set([]);
  }

  dealHand(count: number = 10) {
    const deck = [...this.deck()];
    const hand = deck.splice(0, count);
    this.deck.set(deck);
    this.hand.set(hand);
  }
}
