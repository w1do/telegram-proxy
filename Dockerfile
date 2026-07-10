FROM python:3.12-alpine

WORKDIR /app

# Копируем зависимости и устанавливаем их
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Копируем файл приложения
COPY tg.py ./

EXPOSE 3000

CMD ["python", "tg.py"]
