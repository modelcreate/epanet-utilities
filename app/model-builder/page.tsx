"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import type {
  ModelBuilderStep,
  UploadedFile,
  AssignedGisData,
  AttributeMapping,
  EpanetElementType,
  Projection,
  AssignedFileInfo,
  ModelSettings,
} from "@/lib/types";
import { EPANET_ELEMENTS } from "@/lib/model-builder-constants";
import { isLikelyLatLng } from "@/lib/check-projection";

// Import components (we'll create these)
import { DataAssignmentStep } from "@/components/model-builder/data-assignment-step";
import { AttributeMappingStep } from "@/components/model-builder/attribute-mapping-step";
import { ModelSettingsStep } from "@/components/model-builder/model-settings-step";
import { BuildProgressModal } from "@/components/model-builder/BuildProgressModal";

const ModelBuilderContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get initial step from URL, fallback to "modelSettings"
  const getInitialStep = (): ModelBuilderStep => {
    const stepFromUrl = searchParams.get("step") as ModelBuilderStep;
    const validSteps: ModelBuilderStep[] = [
      "modelSettings",
      "dataAssignment",
      "attributeMapping",
    ];
    return validSteps.includes(stepFromUrl) ? stepFromUrl : "modelSettings";
  };

  // State management
  const [currentStep, setCurrentStep] = useState<ModelBuilderStep>(
    getInitialStep(),
  );

  // Update URL when step changes
  const updateStepInUrl = (step: ModelBuilderStep) => {
    const params = new URLSearchParams(searchParams);
    params.set("step", step);
    router.push(`?${params.toString()}`, { scroll: false });
    setCurrentStep(step);
  };

  // Listen for browser navigation (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      const stepFromUrl = new URLSearchParams(window.location.search).get(
        "step",
      ) as ModelBuilderStep;
      const validSteps: ModelBuilderStep[] = [
        "modelSettings",
        "dataAssignment",
        "attributeMapping",
      ];
      const validStep = validSteps.includes(stepFromUrl)
        ? stepFromUrl
        : "modelSettings";
      setCurrentStep(validStep);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Initialize URL if not present
  useEffect(() => {
    if (!searchParams.get("step")) {
      const params = new URLSearchParams(searchParams);
      params.set("step", "modelSettings");
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

  const [modelSettings, setModelSettings] = useState<ModelSettings>({
    flowUnit: "GPM",
    headlossFormula: "Hazen-Williams",
  });
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [assignedGisData, setAssignedGisData] = useState<AssignedGisData>({});
  const [attributeMapping, setAttributeMapping] = useState<AttributeMapping>(
    {},
  );

  // Keep info about which UploadedFile was assigned to each element type
  const [assignedFileInfo, setAssignedFileInfo] = useState<AssignedFileInfo>(
    {},
  );

  // Build process state
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  type ProgressStep = {
    name: string;
    status: "pending" | "inProgress" | "completed";
  };

  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [inpContent, setInpContent] = useState<string>("");
  const [buildError, setBuildError] = useState<string>("");

  // Web Worker reference
  const workerRef = useRef<Worker | null>(null);

  // Instantiate web worker once on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Dynamically create the worker. Using relative path so that bundler can resolve it.
    workerRef.current = new Worker(
      new URL("../../lib/workers/model-builder-worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        task?: string;
        inpFile?: string;
        message?: string;
      };

      if (data.type === "progress" && data.task) {
        setProgressSteps((prev: ProgressStep[]) => {
          // Mark current inProgress as completed and set the new task to inProgress
          return prev.map((step: ProgressStep) => {
            if (step.name === data.task) {
              return { ...step, status: "inProgress" };
            }
            if (step.status === "inProgress") {
              return { ...step, status: "completed" };
            }
            return step;
          });
        });
      } else if (data.type === "complete" && data.inpFile) {
        setProgressSteps((prev: ProgressStep[]) =>
          prev.map((step: ProgressStep) =>
            step.status === "inProgress"
              ? { ...step, status: "completed" }
              : step,
          ),
        );
        setInpContent(data.inpFile);
        setIsBuilding(false);
      } else if (data.type === "error") {
        setBuildError(data.message || "Unknown error");
        setIsBuilding(false);
      }
    };

    workerRef.current.onerror = (err: ErrorEvent) => {
      setBuildError(err.message);
      setIsBuilding(false);
    };

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Projection state
  const [projections, setProjections] = useState<Projection[]>([]);
  const [loadingProjections, setLoadingProjections] = useState<boolean>(true);
  const [selectedProjection, setSelectedProjection] =
    useState<Projection | null>(null);
  const [originalProjection, setOriginalProjection] =
    useState<Projection | null>(null);

  // Load projections
  useEffect(() => {
    let ignore = false;
    fetch("/projections.json")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          setProjections(data);
        }
      })
      .catch((err) => console.error("Failed to load projection data:", err))
      .finally(() => setLoadingProjections(false));
    return () => {
      ignore = true;
    };
  }, []);

  // Check if data needs reprojection
  const checkDataNeedsReprojection = () => {
    const allGeoJSON = Object.values(assignedGisData).concat(
      uploadedFiles.map((f) => f.geoJSON),
    );

    return allGeoJSON.some((geoJSON) => geoJSON && !isLikelyLatLng(geoJSON));
  };

  const isDataLatLng = () => {
    const allGeoJSON = Object.values(assignedGisData).concat(
      uploadedFiles.map((f) => f.geoJSON),
    );

    return allGeoJSON.every((geoJSON) => geoJSON && isLikelyLatLng(geoJSON));
  };

  // Handlers
  const handleFilesUploaded = (files: UploadedFile[]) => {
    setUploadedFiles(files);
  };

  const handleProjectionSelect = (projection: Projection | null) => {
    setSelectedProjection(projection);
    if (projection && !originalProjection) {
      setOriginalProjection(projection);
    }
  };

  const handleFileAssignment = (
    file: UploadedFile,
    elementType: EpanetElementType,
  ) => {
    // Add the file to assigned data & file info
    setAssignedGisData((prev: AssignedGisData) => ({
      ...prev,
      [elementType]: file.geoJSON,
    }));

    setAssignedFileInfo((prev: AssignedFileInfo) => ({
      ...prev,
      [elementType]: file,
    }));

    // Remove the file from uploaded files
    setUploadedFiles((prev: UploadedFile[]) =>
      prev.filter((f: UploadedFile) => f.id !== file.id),
    );

    // Initialize attribute mapping for this element type
    const element = EPANET_ELEMENTS.find((e) => e.key === elementType);
    if (element) {
      const allAttributes = [
        ...element.requiredAttributes,
        ...element.optionalAttributes,
      ];
      const initialMapping = allAttributes.reduce((acc, attr) => {
        acc[attr] = null;
        return acc;
      }, {} as Record<string, string | null>);

      setAttributeMapping((prev: AttributeMapping) => ({
        ...prev,
        [elementType]: initialMapping,
      }));
    }

    toast({
      title: "✅ File Assigned",
      description: `${file.name} has been assigned to ${element?.name}`,
    });
  };

  const handleFileUnassignment = (elementType: EpanetElementType) => {
    const assignedFile = assignedGisData[elementType];
    if (assignedFile) {
      // Retrieve the original uploaded file if we have it stored
      const originalFile = assignedFileInfo[elementType];

      if (originalFile) {
        setUploadedFiles((prev: UploadedFile[]) => [...prev, originalFile]);
      } else {
        // Fallback: create a placeholder file if original not found (should not happen)
        const fileName = `${elementType}_data.geojson`;
        const newFile: UploadedFile = {
          id: `unassigned_${elementType}_${Date.now()}`,
          file: new File([JSON.stringify(assignedFile)], fileName, {
            type: "application/json",
          }),
          geoJSON: assignedFile,
          name: fileName,
          geometryType: assignedFile.features[0]?.geometry?.type || "Unknown",
          featureCount: assignedFile.features.length,
        };

        setUploadedFiles((prev: UploadedFile[]) => [...prev, newFile]);
      }

      // Remove from assigned data and file info
      setAssignedGisData((prev: AssignedGisData) => {
        const newAssigned = { ...prev };
        delete newAssigned[elementType];
        return newAssigned;
      });

      setAssignedFileInfo((prev: AssignedFileInfo) => {
        const newInfo = { ...prev };
        delete newInfo[elementType];
        return newInfo;
      });

      // Remove from attribute mapping
      setAttributeMapping((prev: AttributeMapping) => {
        const newMapping = { ...prev };
        delete newMapping[elementType];
        return newMapping;
      });

      toast({
        title: "↩️ File Unassigned",
        description: `File has been returned to unassigned files`,
      });
    }
  };

  const handleAttributeMappingChange = (
    elementType: string,
    attribute: string,
    propertyName: string | null,
  ) => {
    setAttributeMapping((prev: AttributeMapping) => ({
      ...prev,
      [elementType]: {
        ...prev[elementType],
        [attribute]: propertyName,
      },
    }));
  };

  const handleNextStep = () => {
    if (currentStep === "modelSettings") {
      updateStepInUrl("dataAssignment");
      return;
    }

    if (currentStep === "dataAssignment") {
      // Check if at least one file is assigned
      const hasAssignedFiles = Object.keys(assignedGisData).length > 0;
      if (!hasAssignedFiles) {
        toast({
          title: "⚠️ No Files Assigned",
          description:
            "Please assign at least one file to an element before proceeding.",
          variant: "destructive",
        });
        return;
      }

      // Check if data needs reprojection and projection is selected
      const needsReprojection = checkDataNeedsReprojection();
      const dataIsLatLng = isDataLatLng();

      if (needsReprojection && !dataIsLatLng && !selectedProjection) {
        toast({
          title: "⚠️ Projection Required",
          description:
            "Your data appears to be in a projected coordinate system. Please select a projection to continue.",
          variant: "destructive",
        });
        return;
      }

      updateStepInUrl("attributeMapping");
    }
  };

  const handlePreviousStep = () => {
    if (currentStep === "attributeMapping") {
      updateStepInUrl("dataAssignment");
    } else if (currentStep === "dataAssignment") {
      updateStepInUrl("modelSettings");
    }
  };

  const handleBuildModel = () => {
    // Prepare configuration object (sent to worker if needed)
    const config = {
      settings: modelSettings,
      assignedData: assignedGisData,
      attributeMapping,
      projection: {
        originalProjection: originalProjection,
        selectedProjection: selectedProjection,
        needsReprojection: checkDataNeedsReprojection(),
        dataIsLatLng: isDataLatLng(),
      },
      metadata: {
        createdAt: new Date().toISOString(),
        version: "1.0.0",
      },
    };

    // Define the list of tasks for UI
    const tasks = [
      "Reading Build Config",
      "Validating Data",
      "Converting MultiString Geometry",
      "Simplifying Crossings",
      "Building Network Graph",
      "Calculating Connectivity",
      "Assigning Elevations",
      "Generating INP File",
      "Finished Build",
    ];

    setProgressSteps(
      tasks.map((name, idx) => ({
        name,
        status: idx === 0 ? "inProgress" : "pending",
      })),
    );
    setIsBuilding(true);
    setInpContent("");
    setBuildError("");

    // Kick off the worker
    workerRef.current?.postMessage(config);
  };

  const handleDownloadInp = () => {
    if (!inpContent) return;

    const blob = new Blob([inpContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `epanet-model-${new Date().toISOString().split("T")[0]}.inp`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="container mx-auto px-4 py-8">
      <Toaster />

      {/* Build Progress Modal */}
      <BuildProgressModal
        open={isBuilding || !!buildError || !!inpContent}
        progressSteps={progressSteps}
        error={buildError || undefined}
        onDownload={inpContent ? handleDownloadInp : undefined}
        showCloseButton={isBuilding ? false : true}
        onClose={() => {
          if (!isBuilding) {
            setBuildError("");
            setInpContent("");
            setProgressSteps([]);
          }
        }}
      />

      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
          EPANET Model Builder
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
          Build an EPANET model from GIS data through a simple three-step
          process
        </p>
      </header>

      {/* Step Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-center space-x-8">
          <div
            className={`flex items-center space-x-2 ${
              currentStep === "modelSettings"
                ? "text-blue-600"
                : "text-slate-400"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                currentStep === "modelSettings"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              1
            </div>
            <span className="font-medium">Model Settings</span>
          </div>

          <div
            className={`w-16 h-0.5 ${
              currentStep === "dataAssignment" ? "bg-blue-600" : "bg-slate-200"
            }`}
          ></div>

          <div
            className={`flex items-center space-x-2 ${
              currentStep === "dataAssignment"
                ? "text-blue-600"
                : "text-slate-400"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                currentStep === "dataAssignment"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              2
            </div>
            <span className="font-medium">Data Assignment</span>
          </div>

          <div
            className={`w-16 h-0.5 ${
              currentStep === "attributeMapping"
                ? "bg-blue-600"
                : "bg-slate-200"
            }`}
          ></div>

          <div
            className={`flex items-center space-x-2 ${
              currentStep === "attributeMapping"
                ? "text-blue-600"
                : "text-slate-400"
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                currentStep === "attributeMapping"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              3
            </div>
            <span className="font-medium">Attribute Mapping</span>
          </div>
        </div>
      </div>

      {/* Render current step */}
      {currentStep === "modelSettings" ? (
        <ModelSettingsStep
          settings={modelSettings}
          onSettingsChange={setModelSettings}
          onNext={handleNextStep}
        />
      ) : currentStep === "dataAssignment" ? (
        <DataAssignmentStep
          uploadedFiles={uploadedFiles}
          assignedGisData={assignedGisData}
          assignedFileInfo={assignedFileInfo}
          onFilesUploaded={handleFilesUploaded}
          onFileAssignment={handleFileAssignment}
          onFileUnassignment={handleFileUnassignment}
          onNext={handleNextStep}
          onPrevious={handlePreviousStep}
          projections={projections}
          loadingProjections={loadingProjections}
          selectedProjection={selectedProjection}
          onProjectionSelect={handleProjectionSelect}
          needsReprojection={checkDataNeedsReprojection()}
        />
      ) : (
        <AttributeMappingStep
          assignedGisData={assignedGisData}
          attributeMapping={attributeMapping}
          onAttributeMappingChange={handleAttributeMappingChange}
          onPrevious={handlePreviousStep}
          onBuildModel={handleBuildModel}
          modelSettings={modelSettings}
        />
      )}
    </main>
  );
};

const ModelBuilderPage = () => {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-slate-600 dark:text-slate-300">Loading...</p>
            </div>
          </div>
        </div>
      }
    >
      <ModelBuilderContent />
    </Suspense>
  );
};

export default ModelBuilderPage;
