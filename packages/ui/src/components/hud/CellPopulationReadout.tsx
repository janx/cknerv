import type { CellPopulationFieldModel } from '../../derives/cellPopulationField.derive';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';
import { ScopeStage } from './primitives';
import {
  POPULATION_LEGEND,
  populationCompositionMixes,
  populationFieldSummary,
  populationRows,
} from './cellPopulation.presentation';

/** One count with the scope it is true in. The scope column is not decoration:
 *  an unqualified population number beside a medium implying millions is the
 *  exact confusion this panel exists to prevent. */
function ScopedRow({ label, value, scope, dim = false }: {
  label: string;
  value: string;
  scope: string;
  dim?: boolean;
}) {
  return (
    <div
      data-population-row={label}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        height: 17,
        whiteSpace: 'nowrap',
        opacity: dim ? 0.6 : 1,
      }}
    >
      <span style={{
        fontFamily: HUD_FONTS.tech,
        fontWeight: 500,
        fontSize: 8.5,
        letterSpacing: 1.6,
        color: HUD_COLORS.dim,
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        marginLeft: 'auto',
        fontFamily: HUD_FONTS.mono,
        fontSize: 11,
        color: HUD_COLORS.ink,
      }}>
        {value}
      </span>
      <span
        data-population-scope
        style={{
          fontFamily: HUD_FONTS.tech,
          fontSize: 7,
          letterSpacing: 1.1,
          color: HUD_COLORS.dim,
          textTransform: 'uppercase',
          minWidth: 96,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {scope}
      </span>
    </div>
  );
}

function MixRow({ label, scope, dao, typed, plain, dim = false }: {
  label: string;
  scope: string;
  dao: string;
  typed: string;
  plain: string;
  dim?: boolean;
}) {
  return (
    <div
      data-population-mix={label}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        height: 15,
        whiteSpace: 'nowrap',
        opacity: dim ? 0.6 : 1,
      }}
    >
      <span style={{
        fontFamily: HUD_FONTS.tech,
        fontWeight: 500,
        fontSize: 8,
        letterSpacing: 1.4,
        color: HUD_COLORS.dim,
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        marginLeft: 'auto',
        fontFamily: HUD_FONTS.mono,
        fontSize: 9,
        color: '#9fb0bd',
      }}>
        {`DAO ${dao} · TYPED ${typed} · PLAIN ${plain}`}
      </span>
      <span style={{
        fontFamily: HUD_FONTS.tech,
        fontSize: 7,
        letterSpacing: 1.1,
        color: HUD_COLORS.dim,
        textTransform: 'uppercase',
        minWidth: 96,
        textAlign: 'right',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {scope}
      </span>
    </div>
  );
}

/**
 * What this dashboard has individualized, and what it has not.
 *
 * The Galaxy renders as a whole organism, so a viewer reasonably reads it as
 * CKB's Cell set. These rows are where that reading is corrected: every count
 * carries the scope it is true in, the field states which scope it is
 * currently claiming, and the legend explains the medium before anyone tries
 * to click it.
 */
export default function CellPopulationReadout({ model }: {
  model: CellPopulationFieldModel;
}) {
  const rows = populationRows(model);
  const mixes = populationCompositionMixes(model);

  return (
    <section
      aria-label="Cell population"
      data-cell-population
      data-population-scope-claim={model.scope}
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: '1px solid rgba(255,152,48,.12)',
      }}
    >
      <ScopeStage
        id="cell-population"
        label="CELL POPULATION"
        accent={HUD_COLORS.cyanWire}
        terminal
        flush
      >
        {rows.map((row) => (
          <ScopedRow
            key={row.label}
            label={row.label}
            value={row.value}
            scope={row.scope}
            dim={row.dim}
          />
        ))}

        <div
          data-population-field
          style={{
            marginTop: 6,
            fontFamily: HUD_FONTS.mono,
            fontSize: 8.5,
            letterSpacing: 0.6,
            color: model.gain > 0 ? '#9fb0bd' : HUD_COLORS.dim,
          }}
        >
          <span style={{
            fontFamily: HUD_FONTS.tech,
            fontSize: 8,
            letterSpacing: 1.4,
            color: HUD_COLORS.dim,
            textTransform: 'uppercase',
            marginRight: 8,
          }}>
            Field
          </span>
          {populationFieldSummary(model)}
        </div>

        {mixes.length > 0 ? (
          <div style={{ marginTop: 7 }}>
            {mixes.map((mix) => (
              <MixRow
                key={mix.label}
                label={mix.label}
                scope={mix.scope}
                dao={mix.dao}
                typed={mix.typed}
                plain={mix.plain}
                dim={mix.dim}
              />
            ))}
          </div>
        ) : null}

        <div
          data-population-legend
          style={{
            marginTop: 7,
            fontFamily: HUD_FONTS.mono,
            fontSize: 8,
            lineHeight: 1.6,
            color: HUD_COLORS.dim,
          }}
        >
          {POPULATION_LEGEND.map((entry) => (
            <div key={entry.term} style={{ display: 'flex', gap: 6 }}>
              <span style={{
                fontFamily: HUD_FONTS.tech,
                fontSize: 7.5,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                minWidth: 84,
              }}>
                {entry.term}
              </span>
              <span>{entry.meaning}</span>
            </div>
          ))}
        </div>
      </ScopeStage>
    </section>
  );
}
