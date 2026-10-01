import { Fragment } from 'react'
import { ipaToCyrillic, splitStress } from '../../../shared/phonetics'
import type { Phonetics, PhoneticsStyle } from '../../../shared/phonetics'

/** Чтение русскими буквами; ударная гласная выделена (см. splitStress). */
function RuReading(props: { ipa: string; lang: string }): JSX.Element {
  const ru = ipaToCyrillic(props.ipa, props.lang)
  const parts = splitStress(ru)
  if (!parts) return <>{ru || ' '}</>
  return (
    <>
      {parts.before}
      <span className="phon-stress">{parts.stressed}</span>
      {parts.after}
    </>
  )
}

/**
 * Иностранный текст с произношением под каждым словом — как подписи в учебнике.
 * Общий для плавающей панели и окна «Переводчик»; оформление у каждого своё
 * (классы phon-* описаны и в styles.css, и в стилях панели).
 *
 * Произношение стоит под словом, а не строкой ниже всего текста: в строке
 * «[aɪ lʌv ˈæplz]» не видно, какой значок к какому слову относится, — а именно
 * это и нужно, когда учишь язык.
 */
export function PhoneticText(props: { phonetics: Phonetics; style: PhoneticsStyle }): JSX.Element {
  const { phonetics: p, style } = props
  const roman = p.kind === 'roman'
  return (
    <div className="phon-text" lang={p.lang}>
      {p.segments.map((s, i) => {
        // промежуток: пробелы, знаки, переводы строк — как в исходном тексте
        if (s.pron === undefined) return <Fragment key={i}>{s.text}</Fragment>
        const pron = s.pron
        // неизвестное слово всё равно занимает строку произношения, иначе строка
        // текста запрыгает по высоте
        const blank = ' '
        return (
          <span key={i} className="phon-word">
            <span className="phon-src">{s.text}</span>
            {(roman || style !== 'ru') && <span className="phon-ipa">{pron || blank}</span>}
            {!roman && style !== 'ipa' && (
              <span className="phon-ru">{pron ? <RuReading ipa={pron} lang={p.lang} /> : blank}</span>
            )}
          </span>
        )
      })}
    </div>
  )
}
