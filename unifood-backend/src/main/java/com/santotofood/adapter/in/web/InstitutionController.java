package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.InstitutionResponse;
import com.santotofood.adapter.in.web.mapper.InstitutionResponseMapper;
import com.santotofood.application.service.InstitutionService;
import com.santotofood.domain.model.Institution;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/institutions")
@RequiredArgsConstructor
public class InstitutionController {

    private final InstitutionService institutionService;
    private final InstitutionResponseMapper institutionResponseMapper;

    @GetMapping("/by-domain")
    public ResponseEntity<InstitutionResponse>
    getInstitutionByEmailDomain(
            @RequestParam("domain") String emailDomain
    ) {

        Institution institution =
                institutionService
                        .findByEmailDomain(emailDomain)
                        .orElseThrow(() ->
                                new IllegalArgumentException(
                                        "No existe una institución asociada al dominio: "
                                                + emailDomain
                                )
                        );

        return ResponseEntity.ok(
                institutionResponseMapper.toResponse(
                        institution
                )
        );
    }

    @GetMapping("/{institutionId}")
    public ResponseEntity<InstitutionResponse>
    getInstitutionById(
            @PathVariable UUID institutionId
    ) {

        Institution institution =
                institutionService
                        .findById(institutionId)
                        .orElseThrow(() ->
                                new IllegalArgumentException(
                                        "No existe la institución con ID: "
                                                + institutionId
                                )
                        );

        return ResponseEntity.ok(
                institutionResponseMapper.toResponse(
                        institution
                )
        );
    }
}