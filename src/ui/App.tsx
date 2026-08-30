import { useMemo, useState, type CSSProperties } from 'react';
import { observationFor } from '../engine/state';
import { ActionLog } from './ActionLog';
import { DrawSources } from './DrawSources';
import { GameOver } from './GameOver';
import { HumanArea } from './HumanArea';
import { OpponentSeat } from './OpponentSeat';
import { HUMAN, playerName } from './format';
import { DEFAULT_PRESET_ID, presetById, profileById } from '../ai/roster';
import { DEFAULT_AI_DELAY_MS, useGame, type UseGameOptions } from './useGame';
import { SettingsPanel } from './settings';
import { RulesPanel } from './RulesPanel';
import './styles.css';

const SPEEDS = [
  { label: 'Slow', factor: 2 },
  { label: 'Normal', factor: 1 },
  { label: 'Fast', factor: 0.35 },
] as const;

export interface AppProps extends UseGameOptions {
  /** Shown as a "Change opponents" button when the caller can reseat the table. */
  onChangeTable?: () => void;
}

export function App(props: AppProps = {}) {
  const [speed, setSpeed] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const baseDelay = props.aiDelayMs ?? DEFAULT_AI_DELAY_MS;

  const {
    game,
    names,
    log,
    hint,
    hintPending,
    isHumanTurn,
    thinkingFor,
    legal,
    play,
    canUndo,
    undo,
    newGame,
    requestHint,
    clearHint,
  } = useGame({ ...props, aiDelayMs: Math.round(baseDelay * speed) });

  // Profiles for the five opponent seats, so each seat can show its rating.
  // An injected agent (tests) means no roster seating, hence the empty list.
  const seatProfiles = useMemo(
    () =>
      props.agent
        ? []
        : (props.seats ?? presetById(DEFAULT_PRESET_ID).seats).map((id) => profileById(id)),
    [props.agent, props.seats],
  );

  // Everything rendered comes from the human's observation, so no card that is
  // hidden from player 0 can reach the DOM.
  const obs = observationFor(game, HUMAN);
  const me = obs.players[HUMAN];

  const hintSpot = hint?.action.type === 'place' ? hint.action.spot : null;
  const hintedSource =
    hint?.action.type === 'draw' && hint.action.source.kind !== 'discard'
      ? hint.action.source.kind
      : null;
  const hintedDiscard =
    hint?.action.type === 'draw' && hint.action.source.kind === 'discard'
      ? hint.action.source.player
      : null;
  const hintIsDiscard = hint?.action.type === 'discard';

  const phaseLabel = game.phase === 'draw' ? 'Draw' : 'Act';
  const turnText = game.terminal
    ? 'Round over'
    : isHumanTurn
      ? game.phase === 'draw'
        ? 'Your turn — take a card'
        : 'Your turn — place it, wave, or discard'
      : `${playerName(game.current, names)} is playing`;

  const finalCycle =
    game.triggerPlayer !== null && game.finalTurnsRemaining !== null && !game.terminal;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">Skip-Bo Golf</h1>
        <div className={`turnbar ${isHumanTurn ? 'turnbar--mine' : ''}`} aria-live="polite">
          <span className="turnbar__dot" aria-hidden="true" />
          <span className="turnbar__who" data-testid="turn-banner">
            {turnText}
          </span>
          {!game.terminal && (
            <span className="turnbar__phase" data-testid="phase-badge">
              {phaseLabel} phase
            </span>
          )}
        </div>
        <div className="speed" role="group" aria-label="Opponent speed">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              type="button"
              className={`speed__btn ${speed === s.factor ? 'speed__btn--on' : ''}`}
              aria-pressed={speed === s.factor}
              onClick={() => setSpeed(s.factor)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => newGame()}>
          New round
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setShowRules(true)}>
          How to play
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setShowSettings(true)}
        >
          Settings
        </button>
        {props.onChangeTable && (
          <button type="button" className="btn btn--ghost" onClick={props.onChangeTable}>
            Change opponents
          </button>
        )}
      </header>

      {finalCycle && (
        <div className="banner banner--final" role="status">
          {playerName(game.triggerPlayer as number, names)} closed the round —{' '}
          {game.finalTurnsRemaining} final turn
          {game.finalTurnsRemaining === 1 ? '' : 's'} to go.
        </div>
      )}

      <main className="table">
        <div
          className="opponents"
          style={{ '--seat-count': obs.players.length - 1 } as CSSProperties}
        >
          {obs.players.map((p, i) =>
            i === HUMAN ? null : (
              <OpponentSeat
                key={i}
                player={i}
                name={names[i] ?? `Player ${i + 1}`}
                blurb={seatProfiles[i - 1]?.blurb}
                tier={seatProfiles[i - 1]?.tier}
                held={game.current === i && !game.terminal ? obs.heldByCurrent : null}
                grid={p.grid}
                discardTop3={p.discardTop3}
                discardCount={p.discardCount}
                isCurrent={game.current === i && !game.terminal}
                isThinking={thinkingFor === i}
                triggered={game.triggerPlayer === i}
                drawable={legal.drawableDiscards.has(i)}
                hinted={hintedDiscard === i}
                onDraw={(player) => play({ type: 'draw', source: { kind: 'discard', player } })}
              />
            ),
          )}
        </div>

        <div className="centre">
          <DrawSources
            centerCard={obs.centerCard}
            drawPileCount={obs.drawPileCount}
            canDrawCenter={legal.canDrawCenter}
            canDrawPile={legal.canDrawPile}
            hintedSource={hintedSource}
            onDrawCenter={() => play({ type: 'draw', source: { kind: 'center' } })}
            onDrawPile={() => play({ type: 'draw', source: { kind: 'pile' } })}
          />
        </div>

        <HumanArea
          grid={me.grid}
          discardTop3={me.discardTop3}
          discardCount={me.discardCount}
          held={obs.held}
          phase={game.phase}
          isMyTurn={isHumanTurn}
          locked={obs.locked}
          legalSpots={legal.placeSpots}
          canDiscard={legal.canDiscard}
          canUndo={canUndo}
          onUndo={undo}
          hintSpot={hintSpot}
          onPlace={(spot) => play({ type: 'place', spot })}
          onDiscard={() => play({ type: 'discard' })}
        />
      </main>

      <aside className="sidebar">
        <section className="panel panel--hint">
          <h2 className="panel__title">Need a nudge?</h2>
          <button
            type="button"
            className="btn btn--hint"
            onClick={requestHint}
            disabled={!isHumanTurn || hintPending}
          >
            {hintPending ? 'Thinking…' : 'Hint'}
          </button>
          {hint && (
            <div className="hint" role="status" data-testid="hint-text">
              <p className="hint__text">{hint.text}</p>
              {hintIsDiscard && <p className="hint__note">Nothing better is on offer.</p>}
              <button type="button" className="btn btn--tiny" onClick={clearHint}>
                Dismiss
              </button>
            </div>
          )}
          {!isHumanTurn && !game.terminal && (
            <p className="hint__note">Hints are available on your own turn.</p>
          )}
        </section>

        <ActionLog entries={log} names={names} />
      </aside>

      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {game.terminal && <GameOver state={game} names={names} onNewGame={() => newGame()} />}
    </div>
  );
}
