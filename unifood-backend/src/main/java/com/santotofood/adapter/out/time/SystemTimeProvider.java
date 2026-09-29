package com.santotofood.adapter.out.time;

import com.santotofood.domain.port.out.TimeProvider;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

@Component
public class SystemTimeProvider implements TimeProvider {

    private final Clock clock;

    public SystemTimeProvider() {
        this.clock = Clock.systemUTC();
    }

    @Override
    public Instant now() {
        return clock.instant();
    }
}