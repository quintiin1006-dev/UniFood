package com.santotofood.domain.port.out;

import java.time.Instant;

/**
 * Puerto de salida que abstrae la obtención del tiempo actual.
 *
 * Permite que los casos de uso dependan de una abstracción
 * y que las pruebas puedan controlar el tiempo sin depender
 * del reloj real del sistema.
 */
public interface TimeProvider {

    Instant now();
}