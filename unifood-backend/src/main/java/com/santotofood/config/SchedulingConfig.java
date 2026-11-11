package com.santotofood.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Spring's own scheduler, no extra dependency. Today it only runs the daily close (B19). */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
