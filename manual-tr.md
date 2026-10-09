# Kriterion — Kılavuz

[English](manual.md) · [Deutsch](manual-de.md) · Türkçe

Kriterion'un kullanımı. Kurulum, anahtar, yedekleme ve güncelleme
[README](README-tr.md) dosyasında anlatılır.

---

**İçindekiler**

- [Giriş](#giriş)
- [Kullanıcılar ve roller](#kullanıcılar-ve-roller)
- [Genel görünüm](#genel-görünüm)
- [Öğe](#öğe)
- [Yorumlar](#yorumlar)
- [Değerlendirme](#değerlendirme)
- [Ayarlar](#ayarlar)
- [Dışa ve içe aktarma](#dışa-ve-içe-aktarma)
- [Telefonda ve tablette](#telefonda-ve-tablette)
- [Dil](#dil)
- [Sözcükler](#sözcükler)
- [Açık ya da koyu](#açık-ya-da-koyu)
- [Yazı boyutu](#yazı-boyutu)

---

## Giriş

Giriş yapmadan yalnızca genel başlık görünür. Oturumlar 30 gün sonra sona
erer. Girişten önce açılan bir bağlantı girişten sonra kendi adresine götürür.
Bir oturum çalışırken sona ererse giriş sayfası nedenini söyler.

Birkaç başarısız denemeden sonra giriş gecikmeli yanıt verir. Aynı adresten on
başarısız denemeden sonra giriş birkaç dakika kilitlenir; kilit yeniden
başlatmadan sonra da sürer ve aynı ağdaki bütün cihazlar için geçerlidir. Giriş
sayfası bekleme süresini dakika ve saniye olarak geri sayar ve ardından “Giriş
yap” düğmesini yeniden açar. IPv6'da bütün /64 ağı tek adres sayılır. Kullanıcı
adına göre yalnızca gecikme uygulanır, kilit hiç uygulanmaz.

“Parolanı mı unuttun?” “Giriş yap” düğmesinin altında durur: yeni bir
bağlantıyı bir yönetici oluşturur. Bir davet bağlantısının sayfası kullanıcı
adını gösterir; böylece parola yöneticisi onu yeni parolayla birlikte saklar.

İlk açılışta sayfa sahip yöneticiyi kurar. Dil tarayıcıdan önceden seçilir ve
üstte değiştirilebilir; kurulumun varsayılan dili ve ilk hesabın dili olur.
Birlikte gelen üç ölçüt bundan sonra bu dilde adlandırılır.

Geçersiz bir davet ya da sıfırlama bağlantısı (süresi dolmuş, kullanılmış,
yanlış ya da hesap kilitli) her zaman aynı iletiyi verir: “Bu bağlantı artık
geçerli değil. Yöneticiden yeni bir tane iste.”

### İki adımlı doğrulama

İsteğe bağlıdır, hesap başına ayarlanır, başlangıçta kapalıdır. Kimse onu
başkası için açamaz ya da kapatamaz, sahip yönetici de. Kod telefondaki bir
uygulamadan gelir; Kriterion kod göndermez.

“Kişisel” altındaki “Hesabım” kartının “İki adımlı doğrulama” bölümünde açmak için:

1. Bir TOTP uygulaması kur, örneğin Google Authenticator, Aegis, 1Password
   ya da iOS'un Parolalar uygulaması.
2. “İki adımlı doğrulamayı aç” düğmesine bas ve parolanı gir. Telefonda
   “Uygulamada aç” uygulamayı doğrudan açar; bilgisayarda anahtar boşluksuz
   yazılır.
3. Altı haneli kodu gir ve “Aç” düğmesine bas.

Bundan sonra giriş parolayı ve kodu sorar. Her kod bir kez geçerlidir; daha
önce kullanılmış bir kod kendi iletisini alır, o zaman uygulamanın bir sonraki
kodunu bekle. Saatler yarım dakika farklı olabilir. Kod ayrıca dışa aktarma, içe aktarma, rol verme
ve başkasının parolasını belirleme öncesinde ve bir sıfırlama bağlantısı
kullanılırken istenir.

**Kurtarma kodları:** İki adımlı doğrulamayı açarken sekiz kod görünür. Kodlar
yalnızca bir kez gösterilir ve her biri bir kez, uygulama kodunun yerine
geçerlidir. **Onları telefondan ayrı sakla.** Kodlar olmadan telefon kaybolursa
hesap da kaybolur. Yeni kodları “İki adımlı doğrulama” kartında parola ve kodla alırsın;
eski kodlar o zaman geçersiz olur. Kodların altındaki “Tümünü kopyala” onları her
satıra bir kod olarak kopyalar.

Telefon ve kodlar yoksa, sahip yönetici iki adımlı doğrulamayı sunucuda kapatır
(README, “Sunucu komutları”).

### İkinci onay

Dışa aktarma, içe aktarma, rol verme, başkasının parolasını belirleme, bağlantı
oluşturma, kullanıcı silme ve posta hesabını kaydetme öncesinde Kriterion
kendi parolanı bir kez daha sorar. Onay bir kez, yalnızca bu işlem için ve
yalnızca bu oturumda geçerlidir.

Onay istenmeyenler: kilitleme ve kilidi açma, kullanıcı oluşturma, kendi
hesabındaki değişiklikler, test e-postası ve öğedeki her şey.

## Kullanıcılar ve roller

| Rol | yetkiler |
|---|---|
| Kullanıcı | kendi öğeleri, yorumları, değerlendirmeleri, test günleri, favorileri |
| Yönetici | ek olarak ölçütler, etiketler, kategoriler, başlık, sözcükler, arama motorları; başkalarının katkılarını silme (değiştirme değil); kullanıcıları yönetme, ama yöneticileri ve sahip yöneticiyi değil |
| Sahip yönetici | ek olarak dışa aktarma, içe aktarma, yedekleme, posta hesabı, rol verme, anahtar değeri, güvenlik günlüğü |

Kurulumu yapan kişi sahip yöneticidir. Bu rol başka birine devredilebilir.

Yönetim “Kullanıcı” kartında yapılır (Ayarlar › Kullanıcı). Kurallar:

- Bir yönetici başka yöneticileri ve sahip yöneticiyi değiştiremez.
- Son etkin sahip yöneticinin rolü düşürülemez, kendisi kilitlenemez ve
  kaldırılamaz.
- Kimse kendini kilitleyemez ya da kaldıramaz.

Kilitleme hemen etki eder: oturum biter, kullanıcının açık bağlantıları
geçersiz olur.

### Kullanıcı oluşturma

“İlk parola” çubuğu yolu belirler:

- **“Bağlantıyla”** (varsayılan): “+ Oluştur ve bağlantı üret” kullanıcıyı
  parolasız oluşturur ve bir bağlantı gösterir. Bağlantıyı açan kişi parolasını
  seçer. O zamana kadar listede “henüz parola yok” yazar.
- **“Parolayı ben veririm”**: parola alanı ve “+ Oluştur”.

Oluşturduktan sonra rol ve “İlk parola” yeniden varsayılana döner.

Bir bağlantı yedi gün ve yalnızca bir kez geçerlidir. İlk açılıştan sonra 15
dakika kalır. **Bağlantıya sahip olan parolayı belirleyebilir.** Bağlantı
yalnızca bir kez gösterilir.

İsteğe bağlı alana bir e-posta adresi girilirse ve posta gönderimi kuruluysa
bağlantı ayrıca e-postayla gider. Adresi bundan sonra yalnızca kullanıcının
kendisi “Hesabım” kartında değiştirir.

### Parolayı sıfırlama

- **Sıfırlama bağlantısı:** eski parola, bağlantı kullanılana kadar geçerlidir;
  sonra kullanıcının bütün oturumları biter.
- **Parolayı doğrudan belirleme:** bütün oturumlar hemen biter.

Kimse artık giriş yapamıyorsa yalnızca sunucudaki komut işe yarar (README).

### Kullanıcı silme

Ad serbest kalır; katkılar kalır ve “Silinen kullanıcı 7” adını taşır. İki
işaretle istenirse şunlar da silinir:

- kullanıcının öğeleri, bunlara başkalarının eklediği yorumlar,
  değerlendirmeler ve test günleriyle birlikte (pencere sayıları gösterir);
- başkalarının öğelerindeki katkıları, oradaki klasörleri de.

Oturumlar, açık bağlantılar, favoriler ve kişisel ayarlar her zaman silinir.
Yalnızca girişi engellemek için silmek yerine kilitle. Silinen kullanıcılar
“Silinen kullanıcılar (n)” altında durur.

### Kayıt olma

Kayıt olma açıkken biri giriş sayfasında “Erişim başvurusu” ile hesap
isteyebilir. Başlangıçta kapalıdır. Açma düğmesi “Başvurular” kartındadır ve
yalnızca şu durumlarda açılabilir:

- bir test e-postası ulaştıysa (posta hesabındaki her değişiklikten sonra
  yeniden),
- `PUBLIC_ADDRESS`, `.env` dosyasında yazılıysa (README, “Yapılandırma”).

Akış:

1. Kullanıcı adı ve e-posta adresiyle, parolasız başvuru.
2. Kriterion 24 saat geçerli bir onay bağlantısı gönderir. Bu bağlantı hesap
   açmaz.
3. “Başvurular” kartında yalnızca onaylanmış başvuru görünür.
4. Bir yönetici onaylar (rol Kullanıcı, davet bağlantısıyla) ya da reddeder.
5. Kullanıcı parolasını davet bağlantısıyla belirler.

Başvurunun yanıtı, ad boşta olsun ya da olmasın, her zaman aynıdır. Aynı anda
en çok 20 başvuru bekleyebilir. Posta gönderimi sonradan çalışmazsa düğme açık
kalır; kart kırmızı bir satır gösterir.

### Posta gönderimi

İsteğe bağlıdır. Posta hesabı olmadan bütün bağlantılar kopyalanmak üzere
gösterilir. Kriterion yalnızca iki tür e-posta gönderir, ikisi de düz metin:
token bağlantıları ve test e-postası.

Posta hesabını yalnızca sahip yönetici kurar, “Posta gönderimi” kartında
(Ayarlar › Kullanıcı). Pencere sağlayıcıyı (GMX, Web.de, Gmail, Strato, IONOS
ya da “Kendi sunucu”), kullanıcı adını, parolayı ve gönderen adresini sorar.
Hazır sağlayıcılarda sunucu, port ve şifreleme Kriterion'dan gelir. Parola
hiçbir zaman gösterilmez; boş bırakılan alan parolayı değiştirmez.

Test postası başarısız olursa kart bilinen nedenleri bir cümleyle söyler,
örneğin “Sunucu ya da bağlantı noktası yanlış”; posta sunucusunun iletisi küçük
yazıyla altında durur.

Sık hatalar:

- Gmail bir uygulama parolası ister.
- GMX ve Web.de, başka programlar üzerinden gönderimin hesapta açılmasını
  ister.
- Gönderen adresi hesaba ait olmalı.
- Hiçbir zaman doğrudan kendi internet bağlantından gönderme, her zaman bir
  sağlayıcının SMTP sunucusu üzerinden gönder.

E-posta spama düşüyorsa, gönderen alan adı için çoğunlukla SPF, DKIM ve DMARC
kayıtları eksiktir. Değerleri posta sağlayıcısı verir. Bunu bir Gmail hesabına
gönderilen test e-postasında “Orijinali göster” ile denetleyebilirsin.

“Bana test e-postası” kendi hesabının adresine gider. Posta sunucusu yanıt
vermezse deneme 20 saniye sonra durur; bağlantı yine de kopyalanmak üzere
gösterilir.

### Oturumlarım

Kart, kendi hesabının nerelerde oturum açtığını gösterir ve “Diğer bütün
oturumları bitir” ile şimdiki oturum dışındaki bütün oturumları bitirir. Cihaz
ve IP adresi saklanmaz. Herkes yalnızca kendi oturumlarını görür. “Parola”
kartındaki yeni bir parola diğer oturumları bitirir; “Hesabım” kartındaki yeni
bir ad ya da adres bitirmez.

### Güvenlik günlüğü

Yalnızca sahip yönetici içindir. Girişleri (başarılı ve başarısız),
kullanıcılardaki ve rollerdeki değişiklikleri, belirlenen parolaları,
oluşturulan ve kullanılan bağlantıları, dışa aktarmayı, içe aktarmayı,
yedeklemeyi ve anahtar değişimini kaydeder. İçinde olmayanlar: öğelerin
içerikleri, IP adresleri, tarayıcı kimlikleri.

“Tümü · Başarısız · Girişler · Kullanıcı · İki adımlı doğrulama · Veritabanı”
görünümlerinin her biri en yeni 100 satırı gösterir. Adlar “Kullanıcı” kartına
götürür. Satırlar 180 gün kalır ve bu süreden önce silinemez.

### Kim neyi yapabilir

Tek bir öğedeki yetkiler. “Yazar”, ilgili şeyi oluşturan kişidir.

| | Yazar | diğer herkes | Yönetici |
|---|---|---|---|
| her şeyi görme | ✔ | ✔ | ✔ |
| başlık, açıklama, fotoğraflar, videolar, etiketler, kategori, test edildi, reddedildi | ✔ | — | ✔ |
| ret gerekçesini yeniden yazma | reddeden kişi | — | reddeden kişi |
| ret gerekçesini kaldırma | ✔ | — | ✔ |
| öğeyi silme | ✔ | — | ✔ |
| favori | herkes kendisi için | | |
| kendi değerlendirmesi, kendi test günü | ✔ | ✔ | ✔ |
| bağlantı ekleme, dosya yükleme | ✔ | ✔ | ✔ |
| kendi bağlantısını, kendi dosyasını silme | ✔ | ✔ | ✔ |
| başkasının bağlantısını, başkasının dosyasını silme | — | — | ✔ |
| klasör oluşturma | ✔ | ✔ | ✔ |
| klasörü yeniden adlandırma, klasöre yükleme | ✔ | — | — |
| klasörü silme | ✔ | — | ✔ |
| dosyayı taşıma, yalnızca kendi klasörlerine | ✔ | — | — |
| “Dosyalar” altındaki bir videonun küçük resmini belirleme | ✔ | — | — |
| bağlantıları yeniden sıralama | ✔ | — | ✔ |
| yorum yazma | ✔ | ✔ | ✔ |
| kendi yorumunu değiştirme | ✔ | — | — |
| başkasının yorumunu silme | — | — | ✔ |
| bir yorumun türü ve sabitlenmesi | ✔ | — | ✔ |
| başkasının test gününü ya da değerlendirmesini silme | — | — | ✔ |
| başkasının puanını ya da değerlendirmesini değiştirme | — | — | — |
| kimin nasıl değerlendirdiğini görme | — | — | ✔ |
| yoruma resim ya da video ekleme | ✔ | — | — |
| yorumdaki resmi ya da videoyu silme | ✔ | — | ✔ |

Yönetici başkalarının katkılarını siler, ama değiştirmez. Başkasının yorumundan
bir resmi kaldırırsa orada “Yönetici 2 resim veya video kaldırdı” yazar.

Diğer herkes öğeyi, yalnızca yazarın ve yöneticinin değiştirebileceği şeylerin
düğmeleri olmadan görür: başlık, açıklama, durum ve kategori düz metindir;
fotoğraf ve video bırakma alanı, kırpma, silme ve sürükleme yoktur. Başkasının
test gününde not, çöp kutusu ve etiketler yalnızca okunur. Sunucu yine de her
değişikliği denetler.

### Yazar

İkinci hesaptan itibaren öğe, yorum ve test günü yazarını gösterir. Bağlantılar
ve dosyalar onları kimin eklediğini gösterir, öğenin yazarı olsa bile; tarih
fareyle üzerine gelince görünür. Değerlendirme yalnızca kendi değerini ve
ortalamayı gösterir; kimin nasıl değerlendirdiğini yalnızca yönetici
“Kim değerlendirdi” ile görür.

## Genel görünüm

### Arama

Arama şu yerlerde metin bulur: başlık, açıklama, kategori, öğedeki etiketler,
test günlerindeki etiketler, bağlantı adresleri, yorumlar ve bir reddin
gerekçesi. `/` arama alanına
atlar. Büyük ve küçük harf fark etmez; `ß` ile `ss` aynı sayılır, I, İ, ı ve i
de öyle. Arama bir kategoriyi her dildeki adıyla bulur.

Her sonuç döşemesi, başlığın altında arama sözcüğünün nerede geçtiğini
gösterir, örneğin “yorum: …Bellavista'da önerildi…”. Sözcük döşemede, bağlantı
listesinde ve yorumlarda vurgulanır. Açılan bir sonucun adresi sözcüğü taşır
(`#/item/12?q=ella`); sayfa yeniden yüklenince vurgu kalır.

Oluştururken “Benzer başlıklar: …” yeni başlıkla dört harf ya da daha uzun
bir sözcüğü ya da ilk beş harfi aynı bir sözcüğü paylaşan mevcut öğeleri
gösterir. Daha çok sözcük paylaşan öğe daha önde durur.

### Filtre ve sıralama

- **Durum:** “Test edildi · Test edilmedi” çubuğu; ikinci tıklama seçimi
  kapatır, seçim yoksa her şey görünür. Ayrıca “Ret” çubuğu “Reddedildi ·
  Reddedilmedi”, “◆ ★” ve satırın sonunda “★ Favoriler”. Hepsi birlikte
  kullanılabilir.
- **Kategoriler:** birden fazlası seçilebilir, her zaman “ya da” ile; seçim
  yoksa her şey görünür. “Kategorisiz” kategorisi olmayan öğeleri gösterir. Bir
  kategorideki sayı diğer bütün filtrelerle sayar; sonucu olmayan kategori
  soluk durur.
- **Etiketler:** birden fazlası seçilebilir. “Ve · Ya da” çubuğu “Ve”
  (varsayılan) ile “Ya da” arasında seçim yapar. Soluk görünen bir etiket diğer
  filtrelerle birlikte hiç sonuç vermez.
- **◆ ★:** “Yok”, “Kısmen” ve 👍 içeren bir çubuk, kendi yıldızlarına göre;
  ikinci tıklama filtreyi kapatır. Test edilmemiş öğeler “Potansiyel” (◆), test
  edilmiş öğeler “Değerlendirme” (★) ile sayılır. Grubun başlığı sözlükteki
  kelimeleri gösterir. “Yok”: kendi yıldızı yok. “Kısmen”: kendi yıldızları
  eşiğin altında, varsayılan olarak ölçütlerin %80'i. 👍: en az eşik kadar. Eşiği
  bir yönetici “Değerlendirme: ölçütler” kartında ayarlar; eşik değerlendirme
  ve potansiyel için geçerlidir. Potansiyel modu kapalıysa yalnızca
  ★ görünür ve test edilmemiş öğeler sonuçta yer almaz; ölçütü olmayan bir
  kutunun öğeleri de. Hiç ölçüt yoksa grup görünmez.
- **“Filtreleri sıfırla (n)”** bir filtre seçildiği anda sıralama satırında
  görünür. Arama sözcüğü, sıralama ve kayıtlı görünümler kalır.
- **Sıralama:** son değişikliğe, değerlendirmeye, potansiyele, başlığa, test
  günü sayısına, ortalamaya ve son günün puanına göre. Yanındaki düğme yönü
  sözcükle söyler, örneğin “yeni → eski”; bir tıklama onu ters çevirir. Değeri
  olmayan öğeler her zaman sonda durur.

Filtreler ve sıralama kaydedilir ve her cihazda geçerlidir. Telefonda
çubuklar yana kayar; başka düğme gelen kenar solar. Bir öğeden dönünce genel
görünüm aynı yerde durur.

Döşeme, test edilmiş öğelerde değerlendirmeyi (“★ 3,8”), diğerlerinde
potansiyeli (“◆ 4,2”) gösterir.

### Kayıtlı görünümler

“+ Görünümü kaydet” filtreleri, sıralamayı ve arama sözcüğünü bir düğme olarak
saklar. Var olan bir ad bir sorudan sonra değiştirilir; düğme yerinde kalır.
Düğmedeki çarpı onu kaldırır. Hesap başına en çok sekiz görünüm.

### Zaman çizgisi

Filtrelerle döşemeler arasında: her test günü için bir nokta, yatayda tarih,
dikeyde puan; 1'den 5'e ölçek sol kenarda durur. İki hesaptan itibaren
üstündeki satır “● benim ○ diğerleri” gösterir. Bir noktaya tıklamak öğeyi
açar. Beş test gününden itibaren görünür ve “Görünüm” kartında kapatılabilir.

En yeni test gününe kadar son üç yılı gösterir. Çizgiye çift tıklamak onu
etkin yapar (turuncu çerçeve): fare tekerleği üç aya kadar yakınlaştırır,
sürüklemek ve kaydırma çubuğu kaydırır; yeniden çift tıklamak, Esc ya da
dışarıya bir tıklama bitirir. Dokunmatik cihazda çift dokunuş açar ve kapatır;
iki parmak hemen yakınlaştırır, tek parmak bir noktada da kaydırır. Bir
noktaya ilk dokunuş başlığı ve puanı gösterir, ikincisi öğeyi açar. Çizginin
altındaki satır kullanımı gösterir; tüm test günleri görünmediği sürece orada
bütün aralık için “Tümünü göster” de durur. Seçilen aralık hesap başına
saklanır.

### Karşılaştırma

Bir döşemedeki ⇄ kutusu öğeyi karşılaştırmaya alır. İki hesaptan itibaren
“Benimkiler · Tümü” kendi değerlerinle herkesin ortalaması arasında geçiş
yapar. Telefonda karşılaştırma bir tablodur: ölçütler satır, öğeler
kaydırılabilen sütun. Oradan açılan bir öğedeki ← karşılaştırmaya geri götürür.

### Zil ve “Açık görevler”

Zil, son açılıştan beri başkalarının yeni yorumlarını ve değerlendirmelerini
bildirir. Panel bunları “Bana yönelik” (`@name` ile anılanlar), “Bana ait
Öğeler” ve “Diğer her şey” olarak ayırır. Her satır neyin yeni olduğunu söyler
ve en eski yeni yoruma götürür; yalnızca değerlendirmeler yeniyse
“Değerlendirme” bloğuna. Yorumların yazarı gösterilir; değerlendirmeler anonim
kalır. Satırlar sayfa yeniden yüklenene kadar kalır, açılanlar soluk durur.
Menü simgesindeki bir nokta da yenilikleri gösterir.

Zilin sınırları:

- Genel görünüm yüklenirken hesaplar, sürekli değil.
- Bildirim başına okundu bilgisi tutmaz: paneli açmak her şeyi görüldü sayar.
- Değişen başlıkları, yeni dosyaları ve yeni test günlerini bildirmez.

“Açık görevler” bütün öğelerin tamamlanmamış görevlerini sayar. Arkasındaki görünüm
bunları son tarihe göre sıralar: gecikmiş, bugün, daha sonra, tarihsiz.
Görevler doğrudan orada tamamlandı olarak işaretlenir. Bir görevin metni ona
götürür; böyle açılan öğedeki ← geri götürür.

### İletiler

“Kaydedildi.” gibi bir onay uzunluğuna göre 2,6 ile 8 saniye durur. Bir hata ✕
onu kapatana ya da görünüm değişene kadar durur. Bir pencerede bir alana ait
hata, örneğin bir öğe ya da klasör oluştururken, alanın altında kırmızı durur.
Bir pencere açıkken iletiler üstte durur.

## Öğe

### Fotoğraflar ve videolar

- Ekleme: dosya seçerek, Ctrl+V ile ya da alana bırakarak. Ctrl+V yalnızca
  resim alır.
- Fotoğraflar 30 MB'a, videolar (MP4, WebM, MOV) 20 MB'a, ses dosyaları 50 MB'a
  kadar. Sınırları sahip yönetici ayarlar. Fotoğraf sayısı sınırlı değildir.
  Bir video çok büyükse ama “Dosya” sınırının altındaysa, ileti “Dosyalar”
  bloğunu gösterir: video orada yüklenebilir.
- **Ses:** “Dosyalar” altındakiyle aynı biçimler: MP3, WAV, FLAC, AAC (`aac`,
  `m4a`), Opus ve Vorbis (`opus`, `ogg`) ve WebM ses (`weba`). Küçük resim, ana
  resim ve tam ekran dosyanın kapağını, yoksa dalga biçimini gösterir; ana
  resim ve tam ekran, “Dosyalar” altındakiyle aynı denetimlerle çalar. Kapak varsa köşede ♪ ve süre durur. Bir ses dosyası ilk
  sıradaysa genel bakıştaki döşeme ve karşılaştırma onu aynı biçimde gösterir.
  Bir ses dosyası, bir video gibi durdurulduğu yerden devam eder. Ses için
  kırpma ve yakınlaştırma yoktur.
- **Adlar:** Fotoğraflar, videolar ve ses dosyaları yüklendikleri adı korur.
  “Bilgi” ve tam ekran bu adı gösterir, ↓ bu adla indirir; uzantı içeriğe
  uyar, WebP olarak saklanan `Taslak.png` `Taslak.webp` olarak iner.
  Telefonlardan ve panodan gelen `image.jpg` gibi sabit adlar yok sayılır. Ad
  yoksa indirilen dosya `<Başlık>_Öğe-12_Fotoğraf-345`, `…_Video-345` ya da
  `…_Ses-345` adını alır; yorumlardaki resimler ve videolar
  `<Başlık>_Öğe-12_Yorum-88_Resim-5`. Ad değiştirilemez.
- Sıradaki ilk resim ana resimdir. Sıra, küçük resimler sürüklenerek
  değiştirilir.
- ← → tuşlarıyla ya da ekrandaki oklarla gezinilir. Bir tıklama tam ekranı
  açar. Orada resme tıklamak özgün resmi %100 gösterir ve tıklanan nokta
  yerinde kalır; üstteki “%100” ortayı gösterir. Orijinal yüklenene kadar
  önceki resim yerinde kalır. Büyütülmüş resimde sürüklemek görünümü kaydırır;
  sürüklemeden tıklamak resmin tamamını yeniden gösterir. Esc, sağ üstteki ✕ ve tarayıcıdaki
  Geri tam ekranı kapatır; fareyle resmin yanına tıklamak da kapatır. Tam
  ekranda ↓ dosyayı indirir. Bir video odaktaysa, örneğin üzerine tıklandıktan sonra, ← ve →
  videoda 5 saniye geri ya da ileri atlar; öğede de tam ekranda da.
- **Tam ekrandaki düğmeler:** soldan sayaç, ⓘ, zincir, videolarda “Tamamını
  yükle” ve “Proxy · Orijinal”, “%100”, ↓, küçük resim için resim simgesi ve
  çöp kutusu; sağda ✕. Olmayan bir düğme o dosya için yoktur ya da izin
  verilmez. Tab önce ✕'e ulaşır.
- **Bağlantıyı kopyala:** tam ekrandaki zincir simgesi gösterilen fotoğrafın ya
  da videonun adresini kopyalar. Adres öğeyi ve tam ekranı bu noktada açar.
- Videolar kendiliğinden oynamaz ve gezinirken durur.
- **Videodaki yer:** Bir video en son durdurulduğu ya da kapatıldığı yerden
  devam eder; hesap başına ve her cihazda. 10 saniye boyunca videonun üzerinde
  “Devam: 3:12” ve “Baştan” görünür. 10 saniyenin altında ve son bölümde (%5,
  en az 10 saniye) Kriterion hiçbir şey hatırlamaz; video o zaman baştan
  başlar. Bu, “Dosyalar” altındaki ve yorumlardaki videolar için de geçerlidir.
- **Videonun tamamını yükleme:** Tam ekranda bir videonun üstünde “Tamamını
  yükle” yazar; bilgisayarda 2 GB'a, telefonda 500 MB'a kadar. Başlık boyutu
  belirtir. Telefonda düğme oklu bir silindirdir. Bir tıklama videoyu durdurur
  ve dosyanın tamamını bir kez yükler. Bu sırada düğme oranı gösterir, örneğin
  “%37”; tam ekranda “Yükleniyor … %37” ve videonun devam edeceği yer yazar.
  Tekrar tıklamak yüklemeyi durdurur. Sonra video aynı yerden devam eder ve
  atlamak için yükleme gerekmez. Düğmede o zaman “✓ Yüklendi”, telefonda onay
  işaretli silindir durur; tarayıcı videonun tamamını zaten yüklediyse de
  böyledir. Kopya, sayfa yeniden yüklenene ya da başka
  bir video tamamen yüklenene kadar kalır. Düğme olmadan tarayıcı videoyu her
  zamanki gibi parça parça yükler. Bu, “Dosyalar” altındaki ve yorumlardaki
  videolar için de geçerlidir.
- **Seçme:** Resim şeridinin üstündeki “Seç” her fotoğrafa ve videoya bir
  kutucuk koyar; tıklama ya da boşluk tuşu seçer. Alttaki çubuk sayıyı gösterir
  ve onay sorusuyla “Sil”, “Tümünü seç” ve “İptal” sunar; Esc seçimi bitirir.
  Yalnızca öğenin yazarı ve yönetici için.
- Panodan yapıştırılan bir resim özgün dosyadan belirgin biçimde büyük olur.
  Dosyanın kendisini yüklemek daha iyidir.

### Kırpma

Resmin üstündeki “Kırpma”, döşemede hangi kare parçanın görüneceğini belirler.
Çerçevenin dışında sürüklemek yeni bir çerçeve çizer, çerçevenin içinde
sürüklemek onu taşır, köşeler ve kenarlar boyutu değiştirir. Kaydırıcı
yakınlaştırmayı ayarlar (telefonda tek boyut ayarı budur). Özgün resim
değişmez. Bununla ilgili ipucu, mod açık kaldıkça resmin altında durur.

### Etiketler, dosyalar, bağlantılar

- **Etiketler:** Etiket bulutunda bir tıklama etiketi verir ya da kaldırır. Test
  günleri kendi etiketlerini taşıyabilir.
- **Dosyalar:** “Dosyalar” bloğunda döşeme ya da liste olarak durur. Bloğun
  başlığındaki “Döşeme” ve “Liste” ile geçiş yapılır; seçim bütün öğeler için
  ve her cihazda geçerlidir. Döşeme küçük resmi ya da uzantıyı, altında adı ve
  boyutu gösterir. Bir ad “_”, “-” ve “.” işaretlerinden sonra satır atlar;
  iki satıra sığmazsa ortadan kısaltılır, uzantı kalır. Liste her dosya için bir satır gösterir: ufak bir küçük
  resim, ad, tür, boyut, yükleme tarihi ve birden fazla hesap varsa yükleyen
  kişi; telefonda adın altında boyut, videoda ve seste süre ve tarih durur.
  Tür şunlardan biridir: Video, Görsel, PDF, Word, Excel, PowerPoint, Metin,
  Arşiv ya da Diğer; bir videoda bu sütunda codec, kare hızıyla çözünürlük ve
  süre durur, örneğin “H.265 · 1080p30 · 3:12”. Sayı görüntünün kısa kenarıdır,
  2160’tan itibaren “4K” yazar; geçmeli videoda “i” alan hızıyla durur, örneğin
  “1080i50”. Bir görselde gösterildiği gibi biçim ve piksel durur, örneğin
  “PNG · 1920 × 1080”. Okunmuş bilgi yoksa orada “Görsel” yazar. Kapalıyken bloğun başlığı yalnızca sayıları ve
  boyutu gösterir, örneğin “3 klasör · 12 video · 9 görsel · 4 diğer ·
  1122,2 MB”; dosyası olmayan bir tür görünmez. Sıralama, görünüm ve düğmeler
  yalnızca açık başlıkta durur. Tıklama, menü, önizleme ve klavye iki görünümde
  de aynıdır. Dosya başına 2 GB'a kadar
  (“Dosya” sınırı), öğe başına en çok 100 dosya.
- **Bilgisayarda liste:** Listenin üstünde bir başlık satırı durur. “Ad”, “Tür”,
  “Boyut” ya da “Tarih” üzerine bir tıklama ona göre sıralar, ikinci tıklama
  yönü ters çevirir; sıralanan sütunda ▲ ya da ▼ durur. Her satırın sonunda ✎
  (düzenle; yalnızca düzenleme iznin olan bir dosyada) ve 🔗 (dosyanın
  bağlantısını kopyala) durur; telefonda ikisi de yalnızca menüdedir. Bir
  videonun proxy'si varsa önlerinde “Proxy” durur; proxy'nin pikselleri ve
  boyutu fareyle üzerine gelince görünür.
- **Sıralama:** “Döşeme” ve “Liste” yanındaki seçim alanı “Ad”, “Tarih”,
  “Boyut” ya da “Tür” seçeneğine göre sıralar. Yanındaki düğme yönü söyler,
  örneğin “A → Z”, “eski → yeni” ya da “büyük → küçük”; bir tıklama onu ters
  çevirir. Seçenek değişince “A → Z”, “eski → yeni” ya da
  “büyük → küçük” geçerli olur; varsayılan, “Tarih” ve “eski → yeni”
  seçenekleridir. “Tür” türleri “Türe göre gruplanmış” düzenindeki gibi, her
  türün içinde de ada göre sıralar; “Z → A” ikisini de ters çevirir. Seçim
  bütün öğeler için ve her cihazda geçerlidir. Tarih, yükleme tarihidir. “Ad”
  büyük ve küçük harf ayrımı yapmaz; “2” sıralamada “10” değerinden önce gelir.
  Klasörsüz dosyalar üstte kalır, her klasör bir grup olarak kalır; klasörler
  aynı seçime uyar: boyuta göre sıralamada dosyalarının toplamıyla, “Tür”
  seçildiğinde ada göre. Süren yüklemeler gruplarının sonunda durur.
- **Gruplama:** İkinci seçim alanındaki “Türe göre gruplanmış” her tür için
  sayıyla birlikte bir ara satır koyar, örneğin “PDF · 3”. Türler ada göre
  sıralanır, “Diğer” en sonda; her türün içinde sıralama geçerlidir. Her klasör
  kendi tür gruplarını alır. Tam ekran aynı sırayla gezinir. Seçim, sıralama
  gibi, bütün öğeler için ve her cihazda geçerlidir.
  Yükleme “+” döşemesiyle, listede “Dosya yükle” ile ya da dosyaları bloğun
  üstüne bırakarak yapılır. Her dosya hemen bir döşeme olarak görünür ve tek tek
  yüklenir, en küçüğü önce. Döşeme “bekliyor”, “340 MB / 1,2 GB · yaklaşık 4
  dk kaldı” gibi ilerlemeyi ya da nedeniyle birlikte ⚠ gösterir. Seçimdeki bir
  dosya “Dosya” sınırından büyükse hiçbiri yüklenmez; ileti dosyayı ve sınırı
  söyler. Başka bir öğe açıldığında yükleme sürer; sekme kapatılırken tarayıcı
  onay ister. Sunucuyla bağlantı yoksa Kriterion 2, 5 ve 15 saniye sonra
  yeniden dener; döşeme saniyeleri geri sayar.
- **Klasörler:** Bloğun başlığındaki “Klasör ekle” bir klasör oluşturur; ad
  1 ile 80 karakter arasındadır, aynı adlara izin verilir. Üstte klasörsüz
  dosyalar, altında sıralama düzeninde klasörler durur; her grubun kendi
  çerçevesi vardır, kapalı bir klasör bir çubuktur. Başlığa bir tıklama klasörü
  açar ya da kapatır; Kriterion bunu hesap başına, her cihazda hatırlar. Yeni
  bir klasör açık durur. Bir klasöre atlamak, örneğin test günü satırından, onu
  yalnızca o an için açar. Başlık dosyaların sayısını ve boyutunu, birden fazla
  hesap varsa klasörü kimin oluşturduğunu da gösterir; kapalıyken
  yüklemelerinin durumunu gösterir. Kendi klasörüne onun “+” düğmesiyle ya da
  üstüne bırakarak yüklersin; başkasının klasörüne kimse yükleyemez. Kendi
  dosyanın menüsündeki “Şuraya taşı …” kendi klasörlerini ve “Klasörsüz”
  seçeneğini sunar; dosya adresini, küçük resmini ve “Herkes düzenleyebilir”
  ayarını korur. Klasördeki ⋯ menüsü “Düzenle …”, “Bağlantıyı kopyala” ve
  “Klasörü sil” sunar; silinen bir klasörün dosyaları bundan sonra klasörsüz
  durur. Dosyalar yüklenirken klasör silinirse bekleyen dosyalar
  ⚠ “Bu klasör artık yok.” gösterir. Hâlihazırda süren bir yükleme tamamlanır;
  dosya sonra klasörsüz durur.
- **Test gününe bağlı klasör:** Oluştururken ve “Düzenle …” altında kendi
  klasörüne aynı öğenin kendi test günlerinden biri bağlanabilir; bir test
  gününün en çok bir klasörü olur. Test günü satırı o zaman 📁 gösterir; bir
  tıklama bloğu ve klasörü açar. Klasörün başlığı tarihi ↑ ile gösterir ve test
  günü satırına geri götürür. Test günü silinirse klasör adı ve dosyalarıyla
  kalır.
- **Parça parça yükleme:** Her dosya 8 MB'lık isteklerle yüklenir. İnternet
  bağlantısı koparsa döşeme durumuyla birlikte “kesildi” gösterir; bağlantı
  gelir gelmez yükleme kendiliğinden sürer. Sekme kapatıldıysa menüdeki
  “Sürdür” aynı dosyayla devam eder. Kesilen bir yükleme 24 saat sonra
  geçersiz olur. Her hesabın en çok üç açık yüklemesi olur. Telefonda sayfayı
  açık ve ekranı açık tut.
- **Önizleme ve dışa aktarma sınırının üstünde:** Bu sınırı aşan bir dosyanın metin önizlemesi
  ve küçük resmi olmaz ve dosya Document Server'da açılmaz; indirilir. PDF'leri,
  resimleri ve videoları tarayıcı göstermeye devam eder. Hiçbir dışa aktarma bu
  dosyaları içermez; yedeklemede bulunurlar.
- **Diskteki dosyalar:** Kriterion her dosyayı ayrı ayrı şifreleyerek
  veritabanıyla aynı dizinde saklar. Sunucuda bir dosya eksikse döşemesi ⚠
  gösterir.
- **Seçme:** Bloğun başlığındaki “Seç” silme iznin olan her dosyaya bir
  kutucuk koyar; tıklama ya da boşluk tuşu seçer. Bir klasörün başlığındaki
  kutucuk içindeki bütün dosyaları, çubuktaki “Tümünü seç” bütün dosyaları
  seçer. Çubuk sayıyı gösterir ve onay sorusuyla “Sil”, seçilen her dosya
  senin dosyansa “Şuraya taşı …” sunar. “İptal” ya da Esc seçimi bitirir.
- **Dosyaya tıklama:** Bir resim ya da video tam ekranı açar; ← ve → aynı
  gruptaki (klasörsüz ya da aynı klasördeki) resimler, videolar ve ses
  dosyaları arasında,
  gösterim sırasıyla gezinir. Üstte dosya adı, yanında küçük olarak öğenin
  başlığı yazar. 1.600 pikselden büyük bir resmi tam ekran ve önizleme, uzun
  kenarı 1.600 piksel olan bir sürümle gösterir; orijinali “100 %” ve “İndir”
  yükler. PDF, metin, Markdown, CSV, log ve `.docx`
  dosyaları önizlemeyi döşemelerin altında, telefonda ayrı sayfada gösterir.
  Yönetici bir Document Server açtıysa bu, Word, Excel ve PowerPoint dosyaları
  ve bunların OpenDocument karşılıkları için de geçerlidir; görüntüleyicinin
  altında dosyayı hangi Document Server'ın gösterdiği yazar. Diğer her dosya
  kendi menüsünü açar. Bir tıklama hiçbir zaman indirme yapmaz.
- **Videolar:** MP4, M4V, WebM ve MOV tam ekranda oynar, iPhone'da da. Döşeme
  bir küçük resim, ▶, süreyi ve sol altta codec'i gösterir, örneğin “H.265”;
  bir görselin döşemesi orada biçimi gösterir, örneğin “JPEG”.
  Kriterion codec'i yükleme bittikten sonra okur; güncellemeden önceki
  videolarda bir sonraki başlatmada. Küçük resim yükleme sırasında tarayıcıda,
  sürenin %10'unda oluşur. Eksikse, örneğin bir içe aktarmadan sonra, videoyu
  yükleyen kişinin tarayıcısı öğe açıldığında onu oluşturur. ⋯ menüsündeki
  “Küçük resmi seç …” tam ekranı “İstediğiniz yere sarın, ardından resim
  simgesine dokunun” notuyla açar; resim simgesi vurgulanır ve gösterilen
  kareyi alır. Bunu yalnızca videoyu yükleyen kişi yapabilir.
  Tarayıcı bir videoyu oynatamazsa, örneğin Firefox'ta HEVC, orada bir cümle ve
  “İndir” durur.
- **Ses:** MP3, WAV, FLAC, AAC (`aac`, `m4a`), Opus ve Vorbis (`opus`, `ogg`)
  ve WebM ses (`weba`) dönüştürülmeden oynar. Döşemeye tıklamak önizlemeyi,
  telefonda tam ekranı açar; ⋯ menüsündeki “Aç” tam ekranı açar. Önizleme ve
  tam ekran dosyanın kapağını ve dalga biçimini gösterir: her bölümün ortalama
  ses düzeyi, çalınan kısım turuncu, konumda dikey bir çizgi. Dalga biçimi bir
  kaydırıcıdır: dokunmak ya da tıklamak oraya atlar, sürüklemek sarar, ← → 5
  saniye atlar, Home ve End başa ve sona gider. ▷ çalar, ⏸ durdurur; süre dalga
  biçiminin altında sağda durur. Fareyle solda hoparlör (sessiz), ses düzeyi
  ve ▷, yanında −48 ile 0 dBFS arasında L ve R için bir seviye göstergesi
  durur: −18'e kadar yeşil, −6'ya kadar sarı, üstü kırmızı. Bir çizgi tepeyi
  1,5 saniye tutar; üstteki kırmızı işaret, göstergeye tıklanana kadar
  aşırı yüklemeyi gösterir. Mono tek bir “M” çubuğu gösterir. Gösterge ses
  düzeyinden önce ölçer ve sessizken de oynar. Ses düzeyi ve sessiz tarayıcı
  başına bütün ses dosyaları için geçerlidir. Fare yoksa, örneğin telefonda,
  yalnızca ▷ ve süre durur; ses düzeyini cihaz ayarlar. Videolar tarayıcının
  denetimlerini korur. Tam ekranda dalga biçimi bütün genişliği kaplar; kapak
  yoksa büyük, kapak varsa onun altında. Döşeme kapağı ya da dalga biçimini, ♪ ve süreyi gösterir. Dalga biçimini tarayıcı
  yükleme sırasında hesaplar; eksikse, örneğin bir içe aktarmadan sonra,
  dosyayı yükleyen kişinin tarayıcısı onu ekler. O zamana kadar bir simge
  durur. Bir ses dosyası, bir video gibi durdurulduğu yerden devam eder.
  Tarayıcı bir dosyayı oynatamazsa, örneğin `m4a` içinde ALAC, orada bir cümle
  ve “İndir” durur. 32 bit FLAC'ta ikinci bir cümle nedenini söyler: Firefox
  gibi bazı tarayıcılar onu çalmaz; Edge, Chrome ve Android çalar.
- **Proxy:** “Dosyalar” altındaki bir video, proxy hazır olur olmaz onu oynatır:
  H.264 biçiminde daha küçük bir sürüm (README, “Videolar için proxy”). Tam
  ekranda “Proxy · Orijinal” çubuğunda oynayan turuncudur; diğer alana tıklamak
  yalnızca bu oynatma için değiştirir. Bir sonraki açılışta yine proxy oynar.
  Konum ikisi için de geçerlidir. “İndir” her zaman
  orijinali verir. `mkv`, `avi`, `wmv` ve `flv` uzantılı videoları hiçbir
  tarayıcı oynatmaz; bunlar ancak proxy ile oynar ve küçük resimleri ondan
  oluşur. Proxy yoksa ya da okunamıyorsa orijinal oynar ve Kriterion proxy'yi
  yeniden oluşturur. Bit hızı değiştikten sonra yenisi hazır olana kadar eski
  proxy oynar; o sırada oynatılan bir video önce sıraya girer.
- **Bir belgenin küçük resmi:** Metin, Markdown, CSV ve log dosyaları döşemede
  ilk satırlarını gösterir. Word, Excel ve PowerPoint dosyaları, bunların
  OpenDocument karşılıkları ve PDF, yönetici bir Document Server açtıysa ilk
  sayfayı gösterir. Resim, yükleme bittikten birkaç saniye sonra ve
  düzenleyicide her kaydetmeden sonra yeniden oluşur. Uzantı resmin üstünde
  durur. Document Server bir dosyayı dönüştüremezse uzantı kalır.
- **Önizleme:** blokta en çok bir tane, kendi grubunun döşemelerinin altında;
  başka bir döşemeye tıklamak onu değiştirir, aynı döşemeye tıklamak kapatır,
  klasörünü kapatmak da. Başlıkta ⤢ ayrı sayfayı açar, ↓ indirir, × ya da Esc
  kapatır. Kriterion bir resim dosyasını resim olarak okuyamazsa döşemede
  uzantı durur.
- **⋯ menüsü:** her döşemede durur ve yalnızca izin verilenleri, çizgilerle
  ayrılmış beş grupta sunar: “Aç” ve “Düzenle”; “İndir”,
  “Bu dosyaya bağlantıyı kopyala” ve “Bilgi”;
  “Yeniden adlandır …”, “Şuraya taşı …” ve “Küçük resmi seç …”; “Önceki sürümü geri yükle” ve “Herkes düzenleyebilir”;
  “Dosyayı sil”. Üstte ad, birden fazla hesap varsa dosyayı kimin ne zaman
  yüklediği de durur. Telefonda menü alt kenarda açılır. Hâlâ yüklenen bir
  döşemede “İptal”, bir hatadan sonra “Yeniden dene” ve “Kaldır” durur.
- **Resimler, videolar ve ses dosyaları için bilgi:** ⋯ menüsündeki “Bilgi” ve
  tam ekrandaki ⓘ dosyada yazanları gösterir. ⓘ öğenin fotoğraflarının,
  videolarının ve ses dosyalarının tam ekranında da durur; orada pencere adı
  ve altında sırayı gösterir, örneğin “Görsel 3 / 7”. Genel: videolarda
  kapsayıcı ve çözünürlük, diğerlerinde biçim; ayrıca dosya boyutu, süre,
  toplam bit hızı, kayıt tarihi ve videolarda ses parçalarının sayısı. Video: codec, profil, çözünürlük,
  kare hızı, bit hızı, bit derinliği, renk alt örneklemesi ve HDR. H.264 ve
  H.265, MediaInfo'daki adı parantez içinde taşır, örneğin “H.265 (HEVC)”;
  listede ve küçük resimde kısaca “H.265” yazar. Her ses parçası için: codec,
  kanallar, örnekleme hızı, bit derinliği, bit hızı ve dil; AAC ve Opus gibi
  kayıplı biçimlerin bit derinliği yoktur. Görsel: ana resim; biçim,
  gösterildiği gibi çözünürlük, bit derinliği, renk uzayı ve renk alt
  örneklemesi. Dosyadaki küçük resimler, örneğin EXIF bloğundakiler, sayı ve
  boyutlarıyla tek satırda durur. Çekim: EXIF'ten çekim zamanı, kamera,
  objektif, pozlama süresi, diyafram, ISO ve odak uzaklığı; dosya taşıyorsa 35
  mm karşılığıyla. Dosyada bir konum varsa yalnızca “Dosyada konum: evet” durur;
  Kriterion koordinat saklamaz. EXIF'te çekim zamanı varsa görsellerde “Genel”
  altındaki “Kayıt tarihi” görünmez. Güncellemeden önceki görselleri Kriterion
  başlatmadan sonra bir kez yeniden okur. Bir video proxy gerektiriyorsa “Proxy”
  grubu durumu, çözünürlüğü, boyutu ve proxy üzerinde ölçülen video ve ses bit
  hızlarını gösterir. Dosyanın belirtmediği bilgiler görünmez. Videolarda
  yalnızca “Genel” açıktır; video, ses ve proxy birlikte “Ayrıntılı bilgi”
  altında durur ve her açılışta kapalıdır. Resimlerde ve ses dosyalarında tüm
  gruplar açıktır.
- **Belgeler için bilgi:** Bir Word, Excel, PowerPoint ya da PDF dosyasının ve
  bunların OpenDocument karşılıklarının ⋯ menüsündeki “Bilgi” iki grup gösterir.
  “Kriterion'da”: yükleyen ve yükleme tarihi, yüklemeden önce değiştirilme
  (dosyanın bilgisayardaki zamanı, yalnızca güncellemeden sonraki dosyalarda),
  Document Server'da son kaydeden ve son kaydetme tarihi, kaydetme sayısı ve
  önceki sürümün tarihi. “Dosyada”: başlık, oluşturan, oluşturulma, son
  düzenleyen, değiştirilme, sayfalar, sözcükler, slaytlar ve uygulama; PDF'te
  başlık, yazar, oluşturma aracı, üreten, oluşturulma, değiştirilme ve sayfalar.
  Pencere açılınca okunur; bir Office dosyasının 1 MB'ı aşan parçaları ve PDF'te
  ilk ve son MB dışındaki her şey okunmaz. `.doc`, `.xls`, `.ppt` ve `.rtf`
  dosyalarında yalnızca Kriterion'daki bilgiler durur. Eksik olan görünmez.
- **Yeniden adlandırma:** Kendi dosyasının ⋯ menüsündeki “Yeniden adlandır …”
  adı uzantısız gösterir; uzantı kalır. Enter kaydeder, Esc iptal eder. Aynı
  klasörde, klasörsüz dosyalarda da, ikinci bir dosya aynı adı taşıyamaz;
  büyük ve küçük harf fark etmez. Yeniden adlandırmayı yalnızca dosyayı
  yükleyen kişi yapabilir, dosya Document Server'da açıkken de. Önceki sürüm
  yeni adı kendi uzantısıyla alır.
- **Klavye:** Tab her döşemeye ve onun ⋯ düğmesine ulaşır. Shift+F10 menüyü
  açar, ↑ ve ↓ seçer, Enter uygular, Esc kapatır.
- **Bağlantıyı kopyala:** dosyanın adresini kopyalar. Bir resmin ya da videonun
  adresi öğeyi ve içinde tam ekranı açar. Diğer her adres dosyayı ayrı sayfada
  açar; önizlemesi olmayan bir dosya orada ↓ ile indirilir.
- **Ayrı sayfa:** dosyayı bütün pencerede gösterir. Sol üstteki ok ve sağ
  üstteki ✕ öğeye, dosyanın döşemesine geri götürür; dosyanın klasörü o zaman
  açık durur. Çubuktaki tam ekran simgesi yalnızca belgeyi bütün ekranda
  gösterir, yatayda da; geri tuşu ya da Esc bunu bitirir. Tarayıcı tam ekranı
  desteklemiyorsa simge görünmez.
- **Düzenleme:** Menüdeki “Düzenle” dosyayı düzenlemek için ayrı sayfada açar;
  yalnızca düzenleme iznin olan dosyalarda durur. “Aç” dosyayı görüntülemek
  için gösterir. Dosyayı yükleyen kişi düzenleyebilir. Dosyada
  “Herkes düzenleyebilir” açıksa her hesap düzenler; değilse yönetici de
  düzenleyemez, dosyayı yalnızca silebilir. Yeni dosyalarda bu ayarın açık
  olup olmayacağını her hesap kendi bölümünde “Belgeler” altında belirler;
  kendi ayarı yoksa yöneticinin başlangıç değeri geçerlidir. Tek bir dosyada
  ayarı, dosyayı yükleyen kişi menüdeki “Herkes düzenleyebilir” ile ya da
  sayfanın çubuğundaki işaretle değiştirir.
  Kaydetme, düzenleyicideki Kaydet ile ve son kişi sayfadan çıktıktan yaklaşık
  10 saniye sonra olur. Bu sırada `.doc`, `.xls` ve `.ppt` dosyaları `.docx`,
  `.xlsx` ve `.pptx` olur; sayfa önce onay ister, OK verilmezse dosya yalnızca
  görüntülenir. Telefonda yalnızca görüntülenir.
- **Önceki sürüm:** Kriterion son düzenlemeden önceki sürümü saklar. Menüdeki
  “Önceki sürümü geri yükle” ya da sayfanın çubuğundaki ↶ onu geri yükler;
  şimdiki sürüm bu sırada önceki sürüm olur, ikinci kez yapmak işlemi geri
  alır. Önceki sürüm yalnızca yedeklemede bulunur, JSON dışa aktarmasında ve
  çöp kutusunda bulunmaz.
- **Bağlantılar:** herkes ekleyebilir. Yeniden sıralamayı öğenin yazarı ya da
  yönetici yapabilir. Adres olmayan bir metin (sözcük, ürün numarası)
  ayarlanmış arama motorunda bir aramaya dönüşür. Başlık, kapalıyken de
  sayıyı söyler, örneğin “3 bağlantı”.

### Açıklama

Metne ya da kaleme tıklamak alanı açar, alandan çıkmak kaydeder, Esc
değişiklikleri iptal eder. Biçimlendirme yorumlardakiyle aynıdır.

### Test günleri

Yalnızca “Test edildi” durumunda. Her satır bir gündür ve bir genel puan
taşır. Bir tarih her kullanıcı için bir kez bulunur; aynı tarihi yeniden girmek
puanı değiştirir. Üç günden itibaren bir eğri gidişatı gösterir. Test günleri
olduğu sürece “Test edildi” geri alınamaz; düğme o zaman soluk ve bir kilitle
durur. Bir satırdaki “+ Etiketler” o günün etiketleri için alanı açar. Bir test gününün klasörü varsa
satırında 📁 durur; bir tıklama klasöre atlar.

### Reddetme

“Reddedildi” seçildiğinde gerekçe için bir alan açılır (isteğe bağlı, en çok
200 karakter). Sonra orada örneğin şu yazar: “14.03.2026, 09:12 tarihinde Anna
tarafından reddedildi — teslim süresi 6 aydan uzun.” Gerekçeyi yalnızca
reddeden kişi değiştirebilir; öğeyi değiştirme izni olan herkes gerekçeyi
kaldırabilir (çöp kutusu). Ret geri alınıp sonra yeniden seçilirse eski gerekçe alanda
öneri olarak durur.

### Bloklar

Bir öğenin blokları tutamaktan sürüklenerek taşınabilir ve başlık satırından
kapatılabilir. Resmin yanında önce potansiyel ve değerlendirme, sonra kategori
ve etiketler durur. Yeni bir kategori ve yeni bir etiket için alanlar “+ Yeni
kategori” ve “+ Etiket” ile görünür. Düzen bütün öğeler için geçerlidir ve “Ayrıntı görünümü” kartında
sıfırlanır. Bir atlama kapalı bir bloğu açarsa bu yalnızca o an için geçerlidir;
başlık satırına bir tıklama bloğu yeniden kapatır.

### Silme ve çöp kutusu

Her silme onay ister. Öğede onay sorusu, öğeye bağlı olanları sayar. Çöp
kutusu simgesi siler; ✕ kapatır, temizler ya da bir atamayı kaldırır, örneğin
öğeden bir etiketi. Kırmızı bir düğme veri kaybettirir; sorusunda odak
“İptal”dedir, Enter hiçbir şey silmez. Silinen
öğeler ve “Dosyalar” altında tek tek silinen dosyalar 30 gün çöp kutusunda
kalır; bunları sahip yönetici geri getirebilir (Ayarlar › Veriler,
“Çöp kutusu” kartı). Klasörler ile bir videonun küçük resmi ve süresi de geri
gelir. Öğenin fotoğrafları ve videoları ile yorumlardaki resimler hemen
silinir.

**Silinen dosyalar …** sahip yönetici için “Dosyalar” bloğunun başlığında durur.
Pencere, öğenin silinen dosyalarını çöp kutusundan ve okunabilen her
yedeklemeden, kaynağı ve klasörüyle birlikte listeler. “Geri al” seçilen
dosyaları eski yazarı ve tarihiyle öğeye geri koyar. Klasörleri yoksa aynı
adla yeniden oluşur. Document Server bir dosyayı yedeklemeden sonra
kaydettiyse, yedeklemedeki sürüm adında “(Backup GG.AA.YYYY)” ile ayrı bir
dosya olarak eklenir. Kopyası yedekleme klasöründe olmayan bir dosya
kutucuksuz durur.

## Yorumlar

Henüz gönderilmemiş ya da düzenlenmekte olan bir yorum bu tarayıcı sekmesinde
kalır. Öğeden çıkıp dönünce ya da sayfa yenilenince yeniden görünür; gönderince,
“İptal” ile ya da çıkış yapınca silinir.

Bir yorumun bir **türü** (not, rapor ya da görev) vardır ve yorum
**sabitlenmiş** olabilir. Sıra: sabitlenmişler, sonra açık görevler, raporlar,
notlar; her grubun içinde en eskisi üstte. Tür düğmesi sırayla geçer:
not → görev → tamamlandı → not.

Sol kenar türü gösterir: turuncu rapor, mavi görev, yeşil tamamlandı.
Sabitlenmiş yorumların altın rengi bir çerçevesi olur.

- **Son tarih:** bir görev bir tarih taşıyabilir. Hatırlatma yapılmaz, hiçbir
  şey gönderilmez.
- **Anma:** metindeki `@name` bir kullanıcıyı anar; kullanıcı zilde bir
  bildirim alır. Boşluk içeren adlar anılamaz.
- **Resimler ve videolar:** yorum başına toplam 6 taneye kadar. Resimler
  küçültülerek, videolar değiştirilmeden saklanır (20 MB'a kadar).
- **Biçimlendirme:** `**fett**`, `_kursiv_`, `` `Code` ``, `[Name](Adresse)`,
  `> ` alıntı, `- ` madde işareti, `1. ` numaralandırma. Alanın üstündeki menü
  ve Ctrl+B / Ctrl+I aynı karakterleri koyar. `\` bir karakterin etkisini
  kaldırır.
- `http://`, `https://` ya da `www.` ile başlayan **adresler** bağlantıya
  dönüşür.
- **Numara:** her yorumun bir numarası vardır (`#3`). Numaraya tıklamak yorumun
  adresini kopyalar; bir alana yapıştırılınca adres, öğe başlığıyla bir
  göndermeye dönüşür.
- **Bir dosyaya ya da fotoğrafa gönderme:** “Bağlantıyı kopyala” ile alınan bir
  adres metinde, açıklamada da, bir rozete dönüşür. Document Server dosyası
  (Word, Excel, PowerPoint, OpenDocument) simge ve dosya adı gösterir; bir
  tıklama altında küçük bir görüntüleyici açar, ikinci tıklama onu kapatır, ⤢
  ayrı sayfayı açar. Görüntüleyici ancak tıklanınca yüklenir; telefonda tıklama
  ayrı sayfayı açar. Bir resim dosyası döşemesini gösterir ve öğedeki tam
  ekranı açar, diğer dosyalar simge ve dosya adı gösterir ve ayrı sayfayı açar.
  Bir fotoğraf döşemesini gösterir ve tam ekranı açar.
  Silinmiş bir dosya “silindi” olarak durur.
- **Bir klasöre gönderme:** klasör menüsündeki “Bağlantıyı kopyala” ile alınan
  bir adres, klasör simgesi ve adıyla bir rozete dönüşür; bir tıklama öğeyi
  klasörle birlikte açar.
- **Alıntılama:** başlık satırındaki tırnak işareti yorumu yazma alanına alır.
  Seçili metin “Alıntıla” menüsüyle alınabilir.

Blok başlığı kısaca sayar: **12 · ⚑3 · ☐3 · ☑2** (yorumlar, raporlar, açık ve
tamamlanmış görevler). Tam metin fareyle üzerine gelince görünür.

## Değerlendirme

Bir öğenin, kendi ölçütleri, ağırlıkları ve ortalamaları olan iki yıldız kutusu
vardır:

- **Potansiyel:** denemeden önce.
- **Değerlendirme:** denemeden sonra, yalnızca test edilmiş öğelerde.

Test edilmiş bir öğede değerlendirme açık, potansiyel kapalıdır; diğerlerinde
tersi. Kapalı kutu sayısını başlığında gösterir. Potansiyel modu
“Potansiyel: ölçütler” kartında kapatılabilir (yalnızca sahip yönetici);
yıldızlar bu sırada korunur.

- Yıldızlar kendi değerlendirmendir. İki kullanıcıdan itibaren yanında herkesin
  ortalaması, iki değerlendirmeden itibaren sayısıyla birlikte durur.
- Satır sonundaki yuvarlak düğme bu satırdaki kendi yıldızlarını kaldırır ve
  “Geri al” sunar.
- Ölçütler farklı ağırlıkta olabilir (adın arkasında `×1,5`). Ortalama 1 ile 5
  arasında kalır.
- Başlıktaki sayıya tıklamak hesabı gösterir: ölçüt başına puan, ağırlık ve
  çarpım, toplam, bölen, sonuç. Yalnızca değerlendirilmiş ölçütler sayılır,
  yuvarlama en sonda yapılır.

Ölçütleri yönetici ayarlarda, iki kutu için ayrı ayrı oluşturur. Bir ölçüt
sabit olarak bir kutuya aittir. Silinen bir ölçüt bütün yıldızlarını da siler.

## Ayarlar

Başlık satırındaki dişli çark ayarları açar. Her bölümün kendi adresi vardır.
Görünür kartı olmayan bölümler görünmez. Kaydedilmemiş değişikliği olan bir
kart “kaydedilmedi” gösterir; bölüm değiştirmeden ya da çıkmadan önce sorulur.
Listelerde kalem ve çöp kutusu yarı görünür, satırın üstünde tam görünür.

| Bölüm | Kartlar |
|---|---|
| Kişisel | Hesabım, Parola, Oturumlarım, Görünüm, Ayrıntı görünümü, Belgeler |
| Veriler | Kategoriler, Etiketler, Değerlendirme: ölçütler, Potansiyel: ölçütler, Çöp kutusu |
| Kullanıcı | Kullanıcı, Başvurular, Güvenlik günlüğü, Posta gönderimi |
| Veritabanı | Sayılar, Depolama ve bakım, Resim biçimleri, Yükleme sınırları |
| Yedekleme | Yedekleme, Eski yedeklemeler, Dışa ve içe aktarma |
| Kurulum | Başlık, Diller, Sözcükler, Arama motorları, Belgeler, Proxy, Sürüm ve şifreleme |

Bir kullanıcı yalnızca “Kişisel” bölümünü görür. Geri kalan her şeyi yönetici
görür; değiştiremediği şeyler metin olarak durur. “Yedekleme” bölümünü,
“Diller”, “Güvenlik günlüğü” ve “Posta gönderimi” kartlarını ve sunucu
komutlarını yalnızca sahip yönetici görür. Diğer herkes bir komut yerine sana
yardım edebilecek bir yöneticiye başvurmasını söyleyen bir cümle okur.

| Kart | İçerik |
|---|---|
| Başlık | giriş öncesi başlık (herkese görünür; az bilgi veren bir başlık seç) ve giriş sonrası başlık |
| Belgeler | Document Server üzerinden görüntülemeyi ve düzenlemeyi açma ve kapatma; kimin düzenleyebileceği (“Yalnızca ben · Herkes”): bir hesap kendi değerini belirlemediği sürece başlangıç değeri; kart bağlantıyı denetler. Adresler ve secret `.env` dosyasında durur, bkz. README |
| Proxy | “Dosyalar” altındaki videolar için proxy'leri açma ve kapatma ve 1080p30 için bit hızını ayarlama, 1 ile 8 Mbit/s arası, yalnızca sahip yönetici, varsayılan kapalı ve 5 Mbit/s; Quick Sync'in mi kodladığı yoksa işlemcinin mi dönüştürdüğü ve nedeni; `/tmp` RAM içinde mi ve ne kadar boş; hazır proxy'ler, eski bit hızıyla olanlar, bekleyen ve başarısız olanlar. Bkz. README, “Videolar için proxy” |
| Sayılar | verinin kapsamı: öğeler, fotoğraflar, videolar, ses dosyaları, yorumlar, bağlantılar ve test günleri |
| Depolama ve bakım | veritabanı boyutu, çöp kutusu, diskteki dosyalar (bunlardan “Önizleme ve dışa aktarma sınırı” değerini aşanlar ve çöp kutusundakiler), yüklemeler, boş alan. Yalnızca varsa: veritabanındaki boş alan (“içindeki boş alan”), hâlâ veritabanında olup diske taşınmayı bekleyen dosyalar, eksik dosyalar, silinmeyi bekleyen dosyalar ve başvurusuz dosyalar. Sahip yönetici için “Eşleştir”, bkz. aşağısı |
| Sürüm ve şifreleme | sürüm, parmak izi, şifreleme yöntemleri; anahtar veritabanının yanında durduğu sürece sahip yönetici için anahtar değeri |
| Kategoriler, Etiketler | oluşturma, yeniden adlandırma, silme; “Yalnızca yöneticiler · Herkes” çubuğu öğede yeni adları kimin oluşturacağını belirler. Var olan bir ad ikinci kez oluşturulmaz; kart onu alanın yanında söyler |
| Değerlendirme: ölçütler, Potansiyel: ölçütler | oluşturma, yeniden adlandırma, sıralama, ağırlık verme (0,2 ile 2 arası, varsayılan 1); “Değerlendirme: ölçütler” kartında genel bakış filtrelerindeki “Kısmen” eşiği (1 ile 100 arası %, varsayılan 80); “Potansiyel: ölçütler” onu bir göndermeyle anar |
| Arama motorları | altı yerleşik ve en çok üç özel arama motoru (yer tutucu olarak `%s`), “Kaydet” ile kaydedilir; yeni bir özel arama motoru ardından işaretli olur. “Varsayılan” sütunundaki seçim noktası başta duran arama motorunu seçer |
| Hesabım | kullanıcı adı ve e-posta adresi; “Kaydet” parolayı sorar. Altında “İki adımlı doğrulama”: açma ve kapatma, yeni kurtarma kodları, bkz. “İki adımlı doğrulama”; kişisel |
| Parola | şimdiki ve yeni parola; ardından diğer bütün oturumlar biter; kişisel |
| Görünüm | dil, renk şeması, yazı boyutu, zaman çizgisi; kişisel |
| Ayrıntı görünümü | resim şeridindeki resimlerin boyutu, görünür bağlantı satırlarının ve arama motoru adlarının sayısı, blokların düzeni; kişisel |
| Belgeler (kişisel) | Document Server'daki renk şeması (“Kriterion · Açık · Koyu”; “Açık” ve “Koyu” onun “Modern” temalarıdır) ve kendi yeni dosyalarını kimin düzenleyebileceği (“Yalnızca ben · Herkes”). Yalnızca Document Server açıkken |

### Eşleştirme

“Depolama ve bakım” kartındaki “Eşleştir” düğmesini yalnızca sahip yönetici
görür. `data/files/` klasörünü veritabanıyla karşılaştırır ve veritabanını
denetler. Silme ve geri alma yalnızca bir onaydan sonra yapılır.

Başvurusuz dosyalar, `data/files/` içinde veritabanının tanımadığı dosyalar,
dizinler ve sembolik bağlantılardır, adları ne olursa olsun; `upload/` bunlara
dahil değildir. Liste boyutu, tarihi ve nedeni gösterir. Bunlardan biri, şu
durumlardan biri geçerliyse silinebilir:

| Durum | Listedeki neden |
|---|---|
| Adı Kriterion oluşturmaz ya da bu bir dizin veya sembolik bağlantıdır | Kriterion bu adı oluşturmaz. |
| Yedekleme klasörü dosyayı aynı boyutta içerir | Yedekleme klasörü onu aynı boyutta içeriyor. |
| Yedekleme klasöründeki hiçbir yedekleme adı anmaz. Bir dosyanın anahtarı yalnızca veritabanındaki satırında durur; satırı olmadan dosya okunamaz | Hiçbir yedekleme onu anmıyor; satırı olmadan okunamaz. |

Geri kalan her şey kalır: bir yedeklemenin andığı ve yedekleme klasörünün
içermediği bir dosya; bir yedeklemenin dosya listesi olmadığı ya da yedekleme
klasörüne erişilemediği sürece Kriterion adı taşıyan her dosya. Bir dizin
içeriğiyle birlikte silinir, sembolik bağlantı bağlantı olarak silinir, hedefi
asla. Bir yedekleme sürerken hiçbir şey silinmez.

Eksik dosyalar diskte yoktur ya da boyutları yanlıştır. Liste öğeyi, klasörü ve
dosya adını gösterir; çöp kutusundaki dosyalar ve önceki sürümler için de.
Yedekleme klasörü dosyayı aynı boyutta içeriyorsa “Geri al” onu geri getirir;
yoksa dosya öğesinde silinebilir. “Dosyalar” altında eksik bir dosya “eksik”
gösterir.

Veritabanı denetimi (SQLite'ın `quick_check` ve `foreign_key_check` komutları)
kendi iş parçacığında çalışır; Kriterion kullanılabilir kalır. Yalnızca bildirir,
hiçbir şeyi onarmaz. Hata bildirirse: README, “Yedeklemeyi geri yükleme”.

### Yükleme sınırları

Onları yalnızca sahip yönetici değiştirir. Bir sonraki yüklemeden itibaren
geçerli olurlar.

| Tür | Varsayılan (MB) | ayarlanabilir (MB) |
|---|---:|---:|
| Fotoğraf | 30 | 1 ile 50 arası |
| Yorumdaki resim | 20 | 1 ile 50 arası |
| Video | 20 | 1 ile 100 arası |
| Yorumdaki video | 20 | 1 ile 100 arası |
| Ses | 50 | 1 ile 100 arası |
| “Dosyalar” altında dosya | 2048 | 1 ile 4096 arası |
| Önizleme ve dışa aktarma sınırı | 50 | 1 ile 100 arası |

İlk sınır “Dosyalar” altındaki dosya başına geçerlidir. “Önizleme ve dışa
aktarma sınırı”na kadar dışa aktarma dosyanın içeriğini taşır ve dosyanın
önizlemesi, küçük resmi ve Document Server desteği olur; bunun üstünde dosya
yalnızca indirilebilir, PDF, resim ve video hariç. Bu değer dosya başına
sınırdan büyükse dosya başına sınır olarak o geçerlidir. Dosyalar 8 MB'lık parçalar hâlinde yüklenir; fotoğraf,
video ve ses sınırlarını öndeki reverse proxy geçirmelidir (README).

### Resim biçimleri

“Resim biçimleri” kartının “Saklama yöntemi” kısmı PNG resimlerinin nasıl
saklanacağını belirler:

| Yöntem | Etkisi |
|---|---|
| PNG | değişmeden, en çok yer kaplar |
| WebP kayıpsız | yaklaşık üçte iki daha küçük; varsayılan |
| WebP kayıplı | yalnızca fotoğraflar için anlamlı; metin içeren ekran görüntülerinde daha büyük |

“Varsayılan” sütunundaki seçim noktası yöntemi seçer. JPEG, GIF ve WebP
değişmeden kalır. “Mevcut resimleri dönüştür” yöntemi var olan resimlere
uygular; resimlerin eski hâli bundan sonra kalmaz. Önce bir yedekleme yap.
Düğme kilitliyse nedeni altında yazar.

### Yedekleme

Yalnızca sahip yönetici için. Eksiksiz, şifrelenmiş bir yedekleme oluşturur.
Kart yeri, süreyi ve son yedeklemeyi gösterir. Yedekleme klasörü sunucuda proje
klasörünün içindeyse, yani `data/` yanındaysa, üstte kırmızı bir uyarı durur;
`data/` ile aynı diskteyse bunu bir cümle söyler. Yedeklemeler doğrudan bağlanan
klasörde durur; alt klasör yoktur. Anahtar değişiminden önceki yedeklemeler
kırmızı işaretlidir. Geri yükleme sunucuda
`./backuptool.sh` ile yapılır (README, “Yedeklemeyi geri yükleme”).

Bir yedekleme, sunucunun yerel saatine göre adlandırılır (`docker-compose.yml`
içindeki `TZ`), örneğin `kriterion-2026-10-07-14-30-00.sqlite`.

Yedekleme, diskteki dosyaları yedekleme klasöründeki `kriterion-files/` içine
kopyalar, her dosyayı yalnızca bir kez. Kopyalama sürerken kart kopyalanan
dosyaların sayısını ve boyutunu gösterir. Diskte eksik dosya varsa kart
sayısını gösterir. Aynı yedekleme klasörüne zaten bir yedekleme yapılıyorsa,
başka bir kurulumdan bile olsa, düğme ikinci bir yedekleme başlatmaz ve bunu
bildirir.

### Eski yedeklemeler

Bütün yedeklemeleri numarası, tarihi, ne kadar eski olduğu ve boyutuyla
listeler. İkinci satır, yedeklemeyi yazan sürümü, dosyalarının sayısını ve
boyutunu ve bunlardan kaçının yalnızca bu yedeklemede bulunduğunu gösterir;
“geri yüklemeden önce”, `backuptool.sh` aracının geri yüklemeden önce
oluşturduğu yedeklemeyi işaretler. Listenin üstünde `kriterion-files/` içindeki
bütün dosyaların sayısı ve boyutu durur. “denetle” bir yedeklemeyi deneme
amaçlı açar ve öğeleri, fotoğrafları, hesapları, en yeni tarihi, listesindeki
dosyalardan kaçının `kriterion-files/` içinde bulunduğunu, sürümü ve şemanın
kurulu sürüme uyup uymadığını gösterir; “Bu anahtarla okunamıyor”, yedeklemenin
başka bir anahtara ait olduğu anlamına gelir.

Listenin başlığındaki “Seç” her yedeklemeye bir kutucuk koyar. Güncel anahtara
uyan en yeni N yedekleme seçilemez; bunlar kuralın koruduğu yedeklemelerle
aynıdır. Çubuktaki “Sil” onay ister, veritabanlarının ve yalnızca bu
yedeklemelerde bulunan dosyaların boyutunu gösterir ve ikinci onayı ister.

Temizleme bir yedeklemeyi yalnızca iki koşul birlikte sağlanırsa siler:
yedekleme en yeni N yedekleme arasında değildir (1 ile 20 arası) **ve** X
günden eskidir (7 ile 365 arası).

- “Her gün gece yarısı temizle” seçeneği başlangıçta kapalıdır. Açıksa
  Kriterion kuralın kapsadıklarını günde bir kez, sunucunun yerel saatiyle
  (`TZ`) gece yarısı siler. Sunucu gece yarısı kapalıysa başlangıçta temizler.
  O sırada bir yedekleme çalışıyorsa bir saat sonra yeniden dener. Yeni bir
  yedekleme hiçbir şey silmez. İşaret yoksa yalnızca düğmeyle silinir. Kart
  son temizliği tarih ve sayıyla söyler.
- Yalnızca yedekleme klasöründeki `kriterion-….sqlite` kalıbına uyan yedeklemeler
  ve bunların `kriterion-….files` listeleri silinir; ayrıca `kriterion-files/`
  içinde, kalan hiçbir listenin anmadığı her kopya. Diğer dosyalar kalır.
- Anahtar değişiminden önceki yedeklemelere kural dokunmaz; onların kendi
  düğmesi vardır.
- Her silme güvenlik günlüğüne yazılır. Gece yarısındaki bir silmede yapan
  olarak “gece yarısı otomatik olarak” durur.

### Çöp kutusu

Yönetici görür, sahip yönetici işlem yapar. Kart son 30 günde silinenleri
listeler: öğeleri ve dosyaları. Bir dosyanın adının önünde öğesi ve klasörü
durur. “Geri yükle” öğeyi bütün içeriğiyle yeniden oluşturur ya da dosyayı
öğesine geri koyar, “Kalıcı olarak sil” siler. Geri yüklemede bir favori, onu
koyan hesap hâlâ varsa o hesaba döner. Kategori, etiketler ve ölçütler,
yeniden adlandırılmış olsalar da şimdiki adlarıyla döner. Bu arada silinmiş
olan dışarıda kalır; ileti bunu söyler. Bir kullanıcı silinirken ya da
“Değiştir” ile yapılan bir içe aktarmayla kaybolan öğeler çöp kutusuna düşmez.

## Dışa ve içe aktarma

İkisi de “Dışa ve içe aktarma” kartındadır, yalnızca sahip yönetici içindir ve
parola sorar.

| Yol | ne için |
|---|---|
| Tek dosyaya dışa aktarma | taşıma, arşiv, paylaşma; şifresiz |
| Parçalar hâlinde dışa aktarma | bir yükleme sınırı ya da bir veri taşıyıcısı büyük bir dosyaya engel olduğunda |
| Yedekleme | veritabanının eksiksiz, şifrelenmiş kopyası (README) |

Dışa aktarma dosyası yalnızca öğeleri, yazar adlarıyla birlikte içerir. Dosyalar
için işaret konursa klasörleri test günleriyle ve “Dosyalar” altındaki her
videonun küçük resmini de taşır; daha eski bir dışa aktarma dosyasından
dosyalar klasörsüz gelir. Önizleme ve dışa aktarma sınırını aşan dosyaları hiçbir dışa aktarma
içermez; kart bunları önceden gösterir. İçe aktarma her dosyayı diske yazar.
Okumadan önce boş alanı denetler: içerik için dosyanın dörtte üçü, ayrıca
veritabanı ve 1 GB; yetmezse rakamlarla reddeder.
İçinde olmayanlar:
kullanıcılar, parolalar, oturumlar, iki adımlı doğrulama, posta hesabı, başlık,
sözcükler, arama motorları, ayarlar, güvenlik günlüğü, çöp kutusu.

**Tek dosyaya dışa aktarma:** “Fotoğraflarla” ya da “Fotoğrafsız”; dosyalar
için ve videolarla sesler için işaretler. Fotoğraflar, videolar ve ses
dosyaları adlarını korur. Kart beklenen boyutu gösterir. 300 MB'tan itibaren
işlemin süreceğine dair bir uyarı çıkar.

**Parçalar hâlinde dışa aktarma:** bir parça yalnızca iki işaret de konmuşsa
eksiksiz bir dışa aktarma dosyasıdır. Parça boyutu seçilebilir (50 ile 300 MB
arası). İçe aktarma:
parça 1 “Değiştir” ile, diğer bütün parçalar “Birleştir” ile.

**İçe aktarma:** pencere “İptal”, “Değiştir” ve “Birleştir” sunar; ana düğme
“Birleştir”dir.

- **Birleştir** ekler ve var olan veriyi bırakır.
- **Değiştir** önce var olan veriyi siler. Geri alınamaz. Ondan önceki soru,
  dosyada olmayan dosyaları, videoları, ses dosyalarını ve yorum resimlerini
  sayar.

Dışa ve içe aktarmadan önceki pencereler dosyanın ne içerdiğini söyler. İçe
aktarma ya her şeyi değiştirir ya da hiçbir şeyi. Katkılar aynı adlı
kullanıcılara, yoksa içe aktaran kişiye gider; sonraki sonuç bu adları
gösterir. Bu yüzden taşımada kullanıcıları önceden aynı adlarla oluştur.

İlerleme göstergesi yoktur; işlem bitene kadar pencere açık kalmalı.

## Telefonda ve tablette

Aynı arayüz, genişliğe ve kullanıma uyarlanmış.

- Telefonda zil, “Açık görevler”, ayarlar ve çıkış menü simgesinin arkasındadır. Arama
  ve “+ Öğe” görünür kalır. Dokunmatik bir tablet de aynı menüyü alır.
- Telefonda filtreler kapalıdır. Düğme etkin filtrelerin sayısını gösterir.
- İletiler bütün genişliği kaplar.
- Dikey konumda 860 piksel genişliğe kadar öğe başlığı resimden önce gösterir.
- Bir öğenin altındaki “‹ Önceki” ve “Sonraki ›” genel görünümün sırasıyla,
  filtre ve sıralamayla gezinir.
- Resimde bir kaydırma hareketiyle gezinilir. Silme büyük resimde yapılır,
  önizleme döşemesinde değil.
- Parmakla sürükleyerek sıralamak için kısa bir süre basılı tutmak gerekir.
- Tam ekranda çift dokunma resmi 2,5 kat büyütür, en fazla orijinale kadar;
  dokunulan nokta parmağın altında kalır. İki parmak resmi yakınlaştırır;
  1.600 piksellik sürümden büyükse orijinal yüklenir. Kaydırma hareketi
  gezinir, videoda da; alttaki zaman çizgisi şeridi ve bir ses dosyasının
  dalga biçimi serbest kalır. ‹ › okları 3 saniye dokunulmayınca, video
  oynarken hemen kaybolur; resme ya da videoya dokunmak onları yeniden
  gösterir. Resmin yanına dokunmak tam ekranı kapatmaz; Geri tuşu kapatır.
- Dikey tutulduğunda tam ekranda başlık sayaçla birlikte ✕ ile kendi
  satırında durur; düğmeler onun altında tek satırdadır. Sığmazlarsa satır
  yana kaydırılabilir; başka düğmelerin geldiği kenar soluklaşır.
- Yatay tutulduğunda tam ekranda küçük resim şeridi yoktur; oklarla ya da
  kaydırarak gezinilir.
- Tarayıcıdaki “Ana ekrana ekle” ile Kriterion bir uygulama gibi eklenebilir.
  İnternet olmadan açılmaz.

## Dil

Almanca, İngilizce ve Türkçe. Herkes dilini “Görünüm” kartında seçer;
değişiklik hemen etki eder. Kendi seçimi olmayan için kurulumun varsayılan dili
geçerlidir. Giriş sayfası, çıkıştan sonra da, varsayılan dili gösterir.

Sahip yönetici “Ayarlar › Kurulum › Diller” altında varsayılan dili ve
seçilebilir dilleri belirler. Yeni bir kurulum, kurulum sırasında seçilen dilde
başlar.

Kategori ve ölçüt adları her dil için ayrı girilebilir. Bir ad eksikse sırayla
şunlar geçerlidir: varsayılan dil, oluşturma sırasındaki dil, özgün metin.
Başka bir dilden gelen ad soluk ve italik durur, altında dili yazar. Listelerin
üstündeki “Adların dili:” çubuğu yeniden adlandırılan dili seçer ve her dil için
bir nokta (hepsi girilmiş) ya da eksik adların sayısını gösterir; sözlükte adı
“Sözcüklerin dili:”dir. Ayarlardan çıkınca yeniden kendi dilin geçerli olur.

## Sözcükler

Arayüzün on beş sözcüğü yeniden adlandırılabilir, örneğin “Öğe” → “Makine” ya
da “Test günü” → “Seans”; “Potansiyel”, “Değerlendirme” ve “Puan” da. Yalnızca
arayüzdeki yazılar değişir; veritabanı ve dışa aktarma dosyaları aynı kalır.
Alanların altındaki bir örnek, sözcükleri gerçek cümlelerde gösterir. Boş
alanlar varsayılana döner. Sözcükler her dil için ayrıdır.

## Açık ya da koyu

“Görünüm” kartında “Açık · Koyu · Otomatik” çubuğu; varsayılan Koyu, Otomatik
işletim sistemini izler. Ayar hesap başına geçerlidir. Tam ekran iki şemada da koyu kalır.

## Yazı boyutu

“Görünüm” kartında, yüzde 80 ile 120 arasında beş kademe. Aralıklar aynı kalır.
Giriş sayfası varsayılan boyutta kalır.
