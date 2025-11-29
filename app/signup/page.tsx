"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";

type SignupFormData = {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  ssn: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    trigger,
    setError: setFieldError,
  } = useForm<SignupFormData>();
  const signupMutation = trpc.auth.signup.useMutation();

  const password = watch("password");

  function getPasswordIssues(pw: string) {
    const issues: string[] = [];
    const commonPasswords = ["password", "12345678", "qwerty"];
    if (pw.length < 8) issues.push("Password must be at least 8 characters");
    if (!/[A-Z]/.test(pw)) issues.push("Password must contain an uppercase letter");
    if (!/[a-z]/.test(pw)) issues.push("Password must contain a lowercase letter");
    if (!/\d/.test(pw)) issues.push("Password must contain a number");
    if (!/[!@#$%^&*(),.?":{}|<>\-=_+\[\]\\/`~;']/.test(pw)) issues.push("Password must contain a special character");
    if (pw && commonPasswords.includes(pw.toLowerCase())) issues.push("Password is too common");
    return issues;
  }

  function getDOBIssues(dob: string) {
    const issues: string[] = [];
    if (!dob) {
      issues.push("Date of birth is required");
      return issues;
    }

    // Support common input shapes but normalize to year/month/day
    let y: number | null = null;
    let m: number | null = null;
    let d: number | null = null;

    // YYYY-MM-DD
    const isoMatch = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(dob);
    // MM/DD/YYYY (user-typed in some locales)
    const slashMatch = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(dob);

    if (isoMatch) {
      y = parseInt(isoMatch[1], 10);
      m = parseInt(isoMatch[2], 10);
      d = parseInt(isoMatch[3], 10);
    } else if (slashMatch) {
      // interpret as MM/DD/YYYY
      const mm = parseInt(slashMatch[1], 10);
      const dd = parseInt(slashMatch[2], 10);
      const yyyy = parseInt(slashMatch[3], 10);
      y = yyyy;
      m = mm;
      d = dd;
    } else {
      // fallback to Date parsing for other shapes
      const parsed = new Date(dob);
      if (isNaN(parsed.getTime())) {
        issues.push("Date of birth is invalid");
        return issues;
      }
      y = parsed.getFullYear();
      m = parsed.getMonth() + 1;
      d = parsed.getDate();
    }

    if (y === null || m === null || d === null) {
      issues.push("Date of birth is invalid");
      return issues;
    }

    // basic year sanity
    if (y < 1900) {
      issues.push("Year must be 1900 or later");
    }

    // build a UTC date to avoid timezone surprises and validate calendar correctness
    const dobUtc = new Date(Date.UTC(y, m - 1, d));
    if (dobUtc.getUTCFullYear() !== y || dobUtc.getUTCMonth() !== m - 1 || dobUtc.getUTCDate() !== d) {
      issues.push("Date of birth is not a valid calendar date");
      return issues;
    }

    const today = new Date();
    const todayUtcMillis = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const dobMillis = dobUtc.getTime();
    if (dobMillis > todayUtcMillis) {
      issues.push("Date of birth must be in the past");
      return issues;
    }

    // compute age precisely in years
    let age = today.getFullYear() - y;
    const monthDiff = today.getMonth() - (m - 1);
    const dayDiff = today.getDate() - d;
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;

    if (age < 18) {
      issues.push("You must be at least 18 years old");
    }
    if (age > 120) {
      issues.push("Date of birth looks implausible");
    }

    return issues;
  }

  const nextStep = async () => {
    // clear previous top-level error
    setError("");

    let fieldsToValidate: (keyof SignupFormData)[] = [];

    if (step === 1) {
      // show all unmet password requirements (do not allow progression)
      const pwIssues = getPasswordIssues(password || "");
      if (pwIssues.length > 0) {
        const msg = pwIssues.join("; ");
        // show combined message in the top alert and inline under the field
        setError(msg);
        setFieldError("password", { type: "manual", message: msg as any });
        return;
      }

      fieldsToValidate = ["email", "password", "confirmPassword"];
    } else if (step === 2) {
      // validate DOB inline before progressing
      const dob = watch("dateOfBirth");
      const dobIssues = getDOBIssues(dob || "");
      if (dobIssues.length > 0) {
        const msg = dobIssues.join("; ");
        // mirror the password behavior: show top-level alert and inline field error
        setError(msg);
        setFieldError("dateOfBirth", { type: "manual", message: msg as any });
        return;
      }

      fieldsToValidate = ["firstName", "lastName", "phoneNumber", "dateOfBirth"];
    }

    const isValid = await trigger(fieldsToValidate);
    if (isValid) {
      setStep(step + 1);
    }
  };

  const prevStep = () => setStep(step - 1);

  const onSubmit = async (data: SignupFormData) => {
    try {
      setError("");
      await signupMutation.mutateAsync(data);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">Create your account</h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-300">Step {step} of 3</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Email
                </label>
                <input
                  {...register("email", {
                    required: "Email is required",
                    pattern: {
                      value: /^\S+@\S+$/i,
                      message: "Invalid email address",
                    },
                  })}
                  type="email"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Password
                </label>
                <input
                  {...register("password", {
                    required: "Password is required",
                    minLength: {
                      value: 8,
                      message: "Password must be at least 8 characters",
                    },
                    validate: {
                      notCommon: (value) => {
                        const commonPasswords = ["password", "12345678", "qwerty"];
                        return !commonPasswords.includes(value.toLowerCase()) || "Password is too common";
                      },
                      hasUpper: (value) => /[A-Z]/.test(value) || "Password must contain an uppercase letter",
                      hasLower: (value) => /[a-z]/.test(value) || "Password must contain a lowercase letter",
                      hasNumber: (value) => /\d/.test(value) || "Password must contain a number",
                      hasSpecial: (value) => /[!@#$%^&*(),.?":{}|<>\-=_+\[\]\\/`~;']/.test(value) || "Password must contain a special character",
                    },
                  })}
                  type="password"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.password && errors.password.message && (
                  <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Confirm Password
                </label>
                <input
                  {...register("confirmPassword", {
                    required: "Please confirm your password",
                    validate: (value) => value === password || "Passwords do not match",
                  })}
                  type="password"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.confirmPassword && (
                  <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    First Name
                  </label>
                  <input
                    {...register("firstName", { required: "First name is required" })}
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                  />
                  {!error && errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>}
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    Last Name
                  </label>
                  <input
                    {...register("lastName", { required: "Last name is required" })}
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                  />
                  {!error && errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>}
                </div>
              </div>

              <div>
                  <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Phone Number
                </label>
                <input
                  {...register("phoneNumber", {
                    required: "Phone number is required",
                    pattern: {
                      value: /^\d{10}$/,
                      message: "Phone number must be 10 digits",
                    },
                  })}
                  type="tel"
                  placeholder="1234567890"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.phoneNumber && <p className="mt-1 text-sm text-red-600">{errors.phoneNumber.message}</p>}
              </div>

              <div>
                  <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Date of Birth
                </label>
                <input
                  {...register("dateOfBirth", { required: "Date of birth is required" })}
                  type="date"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.dateOfBirth && <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="ssn" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Social Security Number
                </label>
                <input
                  {...register("ssn", {
                    required: "SSN is required",
                    pattern: {
                      value: /^\d{9}$/,
                      message: "SSN must be 9 digits",
                    },
                  })}
                  type="text"
                  placeholder="123456789"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.ssn && <p className="mt-1 text-sm text-red-600">{errors.ssn.message}</p>}
              </div>

              <div>
                <label htmlFor="address" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Street Address
                </label>
                <input
                  {...register("address", { required: "Address is required" })}
                  type="text"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                />
                {!error && errors.address && <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>}
              </div>

              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-3">
                  <label htmlFor="city" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    City
                  </label>
                  <input
                    {...register("city", { required: "City is required" })}
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                  />
                  {!error && errors.city && <p className="mt-1 text-sm text-red-600">{errors.city.message}</p>}
                </div>

                <div className="col-span-1">
                  <label htmlFor="state" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    State
                  </label>
                  <input
                    {...register("state", {
                      required: "State is required",
                      pattern: {
                        value: /^[A-Z]{2}$/,
                        message: "Use 2-letter state code",
                      },
                    })}
                    type="text"
                    placeholder="CA"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                  />
                  {!error && errors.state && <p className="mt-1 text-sm text-red-600">{errors.state.message}</p>}
                </div>

                <div className="col-span-2">
                  <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                    ZIP Code
                  </label>
                  <input
                    {...register("zipCode", {
                      required: "ZIP code is required",
                      pattern: {
                        value: /^\d{5}$/,
                        message: "ZIP code must be 5 digits",
                      },
                    })}
                    type="text"
                    placeholder="12345"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border dark:bg-gray-800 dark:border-gray-700 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:text-gray-100"
                  />
                  {!error && errors.zipCode && <p className="mt-1 text-sm text-red-600">{errors.zipCode.message}</p>}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900 p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="flex justify-between">
            {step > 1 && (
              <button
                type="button"
                onClick={prevStep}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                Previous
              </button>
            )}

            {step < 3 ? (
              <button
                type="button"
                onClick={nextStep}
                className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={signupMutation.isPending}
                className="ml-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {signupMutation.isPending ? "Creating account..." : "Create Account"}
              </button>
            )}
          </div>
        </form>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
