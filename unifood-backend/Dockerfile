# Backend de UniFood para Render (runtime docker). Contexto de build: unifood-backend/.
# Sin secretos: todas las variables llegan en tiempo de ejecución desde Render.

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY mvnw pom.xml ./
COPY .mvn .mvn
COPY src src
RUN chmod +x mvnw && ./mvnw -B -DskipTests package \
 && mv target/*.jar /workspace/app.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system unifood && useradd --system --gid unifood --no-create-home unifood
COPY --from=build /workspace/app.jar /app/app.jar
USER unifood
EXPOSE 8080
# Memoria: el heap usa como máximo el 70 % del límite del contenedor; el GC serial ahorra RAM
# en instancias pequeñas; si se agota la memoria, el proceso sale (Render lo reinicia).
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-XX:+UseSerialGC", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
