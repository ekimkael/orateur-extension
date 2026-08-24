import assert from "node:assert/strict"
import test from "node:test"
import { detectLang } from "./detect-lang.ts"

const FR =
  "Le chat est assis sur le tapis et regarde la fenêtre avec attention, " +
  "pendant que la pluie tombe doucement sur les toits de la ville entière."
const EN =
  "The cat is sitting on the mat and watching the window with attention, " +
  "while the rain falls gently on the roofs of the whole city outside."
const ES =
  "El gato está sentado en la alfombra y mira la ventana con atención, " +
  "mientras la lluvia cae suavemente sobre los tejados de toda la ciudad."
const DE =
  "Die Katze sitzt auf der Matte und schaut aufmerksam aus dem Fenster, " +
  "während der Regen sanft auf die Dächer der ganzen Stadt fällt und bleibt."
const IT =
  "Il gatto è seduto sul tappeto e guarda la finestra con attenzione, " +
  "mentre la pioggia cade dolcemente sui tetti di tutta la città intera."
const PT =
  "O gato está sentado no tapete e olha pela janela com atenção, " +
  "enquanto a chuva cai suavemente sobre os telhados de toda a cidade inteira."

test("détecte le français", () => {
  assert.equal(detectLang(FR, null), "fr")
})

test("détecte l'anglais", () => {
  assert.equal(detectLang(EN, null), "en")
})

test("détecte l'espagnol, l'allemand, l'italien, le portugais", () => {
  assert.equal(detectLang(ES, null), "es")
  assert.equal(detectLang(DE, null), "de")
  assert.equal(detectLang(IT, null), "it")
  assert.equal(detectLang(PT, null), "pt")
})

test("script grec tranche seul", () => {
  const text = "Ο καιρός σήμερα είναι πολύ ωραίος και ο ήλιος λάμπει στον ουρανό όλη την ημέρα."
  assert.equal(detectLang(text, null), "el")
})

test("hangul tranche seul", () => {
  const text = "오늘 날씨가 정말 좋고 하늘에 구름이 하나도 없어서 산책하기에 아주 좋은 날이다."
  assert.equal(detectLang(text, null), "ko")
})

test("kana tranche seul, même mêlé de kanji", () => {
  const text = "今日はとても良い天気で、空には雲ひとつなく、散歩するのに最適な一日です。"
  assert.equal(detectLang(text, null), "ja")
})

test("arabe tranche seul", () => {
  const text = "الجو اليوم جميل جدا والسماء صافية تماما وهذا يوم رائع للمشي في الحديقة الكبيرة."
  assert.equal(detectLang(text, null), "ar")
})

test("devanagari tranche seul", () => {
  const text = "आज मौसम बहुत अच्छा है और आकाश में बादल नहीं हैं यह टहलने के लिए एकदम सही दिन है।"
  assert.equal(detectLang(text, null), "hi")
})

test("cyrillique se départage entre russe et ukrainien via les lettres exclusives", () => {
  const ru =
    "Это была обычная история о том, что происходит каждый день в этом городе. Она шла по " +
    "улице и думала о своей работе, о том, как быстро летит время, и о том, что нужно успеть."
  const uk =
    "Сьогодні дуже гарна погода і небо зовсім чисте, а це чудовий день для прогулянки в парку."
  assert.equal(detectLang(ru, null), "ru")
  assert.equal(detectLang(uk, null), "uk")
})

test("cyrillique se départage entre russe et bulgare par mots-outils", () => {
  const ru =
    "Это была обычная история о том, что происходит каждый день в этом городе. Она шла по " +
    "улице и думала о своей работе, о том, как быстро летит время, и о том, что нужно успеть."
  const bg =
    "Това беше обикновена история за това, което се случва всеки ден в този град. Тя вървеше " +
    "по улицата и мислеше за своята работа, за това колко бързо лети времето и за това, което трябва."
  assert.equal(detectLang(ru, null), "ru")
  assert.equal(detectLang(bg, null), "bg")
})

test("texte trop court renvoie le repli", () => {
  assert.equal(detectLang("Hello world", "fr"), "fr")
  assert.equal(detectLang("Hello world", null), null)
})

test("charabia sans script dominant renvoie le repli", () => {
  assert.equal(detectLang("xk qz vv 7 8 !! ## ??? ...", "fr"), "fr")
})

test("chinois (han sans kana) renvoie le repli, hors modèle", () => {
  const text = "今天天气非常好，天空万里无云，是一个非常适合散步的美好日子，大家都出来了。"
  assert.equal(detectLang(text, "fr"), "fr")
  assert.equal(detectLang(text, null), null)
})

test("une langue sans table de score reste le repli si elle l'est déjà", () => {
  // Finnois : script latin, mais aucune table — le score ne peut pas le
  // confirmer, donc il ne doit pas basculer vers une autre langue latine.
  const fi =
    "Tänään on todella kaunis päivä ja taivas on täysin pilvetön, joten on hyvä hetki kävellä ulkona."
  assert.equal(detectLang(fi, "fi"), "fi")
})

test("paragraphe anglais isolé dans un contexte français bascule bien", () => {
  assert.equal(detectLang(EN, "fr"), "en")
})
